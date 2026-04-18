"""
LS-Det v1  —  道路病害轻量化检测模型
======================================
网络结构 PyTorch 实现，对应架构配置 lsdet_arch.yaml。

模块层次
--------
LSDet
├── Backbone
│   ├── ConvBN × 2          (stem 标准卷积)
│   ├── C3k2Block × 4       (跨阶段局部网络块)
│   ├── DSConv × 3          (深度可分离下采样，替代标准卷积)
│   ├── SPPF                (空间金字塔池化)
│   └── C2PSA               (自注意力增强)
├── Neck (FPN + PAN)
│   ├── FPN: P5→P4→P3 自顶向下特征融合
│   └── PAN: P3→P4→P5 自底向上特征融合
└── DecoupledHead × 3       (P3/P4/P5 三尺度解耦检测头)
"""

import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import List, Tuple


# ==============================================================================
# 基础构建块
# ==============================================================================

class ConvBN(nn.Module):
    """标准卷积 + BN + SiLU 激活（用于 stem 层）。"""

    def __init__(self, in_c: int, out_c: int, k: int = 1, s: int = 1, p: int = -1):
        super().__init__()
        p = k // 2 if p < 0 else p
        self.conv = nn.Conv2d(in_c, out_c, k, s, p, bias=False)
        self.bn   = nn.BatchNorm2d(out_c, eps=1e-3, momentum=0.03)
        self.act  = nn.SiLU(inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.act(self.bn(self.conv(x)))


class DSConv(nn.Module):
    """
    深度可分离卷积下采样块（Depthwise Separable Convolution）。

    替代骨干网络中间层的标准卷积，在保持特征表达能力的同时
    将参数量降低约 1/k²（k=3 时约减少 89%）。

    结构：DepthwiseConv(k×k, groups=in_c) → PointwiseConv(1×1) → BN → SiLU
    """

    def __init__(self, in_c: int, out_c: int, k: int = 3, s: int = 1):
        super().__init__()
        p = k // 2
        # 深度卷积：每通道独立空间滤波
        self.dw = nn.Conv2d(in_c, in_c,  k, s, p, groups=in_c, bias=False)
        # 逐点卷积：跨通道线性组合
        self.pw = nn.Conv2d(in_c, out_c, 1, 1, 0, bias=False)
        self.bn  = nn.BatchNorm2d(out_c, eps=1e-3, momentum=0.03)
        self.act = nn.SiLU(inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.act(self.bn(self.pw(self.dw(x))))


class Bottleneck(nn.Module):
    """标准残差瓶颈块。"""

    def __init__(self, c: int, shortcut: bool = True, e: float = 0.5):
        super().__init__()
        hidden = int(c * e)
        self.cv1 = ConvBN(c, hidden, 3)
        self.cv2 = ConvBN(hidden, c, 3)
        self.add = shortcut

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.cv2(self.cv1(x)) if self.add else self.cv2(self.cv1(x))


class C3k2Block(nn.Module):
    """
    跨阶段局部网络块（Cross Stage Partial v2）。
    将输入通道分为两路，一路经瓶颈堆叠，最终 Concat 融合，
    在减少参数的同时保持梯度流通畅。
    """

    def __init__(self, in_c: int, out_c: int, n: int = 1,
                 shortcut: bool = False, e: float = 0.5):
        super().__init__()
        hidden = int(out_c * e)
        self.cv1 = ConvBN(in_c,  hidden, 1)
        self.cv2 = ConvBN(in_c,  hidden, 1)
        self.cv3 = ConvBN(2 * hidden, out_c, 1)
        self.m   = nn.Sequential(*[Bottleneck(hidden, shortcut) for _ in range(n)])

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.cv3(torch.cat([self.m(self.cv1(x)), self.cv2(x)], dim=1))


class SPPF(nn.Module):
    """
    空间金字塔池化快速版（Spatial Pyramid Pooling Fast）。
    通过串联多次 MaxPool 模拟多尺度感受野，无需并联多个池化分支。
    """

    def __init__(self, in_c: int, out_c: int, k: int = 5):
        super().__init__()
        hidden = in_c // 2
        self.cv1  = ConvBN(in_c,  hidden, 1)
        self.cv2  = ConvBN(hidden * 4, out_c, 1)
        self.pool = nn.MaxPool2d(k, stride=1, padding=k // 2)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x  = self.cv1(x)
        p1 = self.pool(x)
        p2 = self.pool(p1)
        p3 = self.pool(p2)
        return self.cv2(torch.cat([x, p1, p2, p3], dim=1))


class C2PSA(nn.Module):
    """
    跨阶段局部 + 自注意力增强模块（Cross Stage Partial with Self-Attention）。
    在 P5 最深层特征图上建模全局上下文，辅助坑槽等大面积病害的定位。
    使用多头注意力代替标准点积，控制计算开销。
    """

    def __init__(self, c: int, n: int = 1, num_heads: int = 4):
        super().__init__()
        self.cv1 = ConvBN(c, c, 1)
        self.cv2 = ConvBN(c, c, 1)
        self.attn = nn.MultiheadAttention(c, num_heads, batch_first=True)
        self.norm = nn.LayerNorm(c)
        self.ffn  = nn.Sequential(
            nn.Linear(c, c * 2), nn.GELU(), nn.Linear(c * 2, c)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, c, h, w = x.shape
        shortcut = x
        x  = self.cv1(x)
        # 展平空间维度，送入自注意力
        xf = x.flatten(2).permute(0, 2, 1)          # (B, HW, C)
        xf, _ = self.attn(xf, xf, xf)
        xf = self.norm(xf)
        xf = xf + self.ffn(xf)
        x  = xf.permute(0, 2, 1).reshape(b, c, h, w)
        return self.cv2(x) + shortcut


# ==============================================================================
# 检测头
# ==============================================================================

class DecoupledHead(nn.Module):
    """
    解耦检测头（Decoupled Detection Head）。

    将分类分支与回归分支完全解耦，各自独立优化：
    - 分类分支：2层 Conv → 类别概率
    - 回归分支：2层 Conv → 边界框坐标 (x, y, w, h)

    针对道路病害长条形目标，解耦架构可避免分类损失干扰
    边界框回归的梯度，显著降低细长裂缝的误检率。
    """

    def __init__(self, in_c: int, nc: int = 4, reg_max: int = 16):
        super().__init__()
        self.nc      = nc
        self.reg_max = reg_max
        hidden = max(in_c, 64)

        # 分类分支
        self.cls_conv = nn.Sequential(
            ConvBN(in_c, hidden, 3),
            ConvBN(hidden, hidden, 3),
        )
        self.cls_pred = nn.Conv2d(hidden, nc, 1)

        # 回归分支（DFL: Distribution Focal Loss 格式）
        self.reg_conv = nn.Sequential(
            ConvBN(in_c, hidden, 3),
            ConvBN(hidden, hidden, 3),
        )
        self.reg_pred = nn.Conv2d(hidden, 4 * reg_max, 1)

        self._init_weights()

    def _init_weights(self):
        # 分类偏置初始化：-log((1-p)/p)，p=0.01，抑制训练初期大量负样本
        nn.init.constant_(self.cls_pred.bias, -math.log(99))
        nn.init.constant_(self.reg_pred.bias, 1.0)

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        cls = self.cls_pred(self.cls_conv(x))   # (B, nc, H, W)
        reg = self.reg_pred(self.reg_conv(x))   # (B, 4*reg_max, H, W)
        return cls, reg


# ==============================================================================
# 完整模型
# ==============================================================================

class LSDet(nn.Module):
    """
    LS-Det v1  道路病害轻量化检测模型。

    Parameters
    ----------
    nc       : 类别数，默认 4（D00/D10/D20/D40）
    img_size : 输入分辨率，默认 960

    使用示例
    --------
    >>> model = LSDet(nc=4)
    >>> x = torch.randn(1, 3, 960, 960)
    >>> cls_list, reg_list = model(x)   # 推理模式
    """

    # 各检测尺度对应的骨干输出通道数
    _FEAT_CHANNELS = [256, 512, 1024]   # P3 / P4 / P5

    def __init__(self, nc: int = 4, img_size: int = 960):
        super().__init__()
        self.nc       = nc
        self.img_size = img_size

        # ── 骨干网络 ──────────────────────────────────────────────────────────
        # stem（标准卷积）
        self.stem = nn.Sequential(
            ConvBN(3,   64,  3, 2),   # P1/2
            ConvBN(64,  128, 3, 2),   # P2/4
            C3k2Block(128, 256, n=2, shortcut=False, e=0.25),
        )

        # P3（深度可分离下采样 + C3k2）
        self.p3 = nn.Sequential(
            DSConv(256, 256, 3, 2),
            C3k2Block(256, 512, n=2, shortcut=False, e=0.25),
        )

        # P4（深度可分离下采样 + C3k2）
        self.p4 = nn.Sequential(
            DSConv(512, 512, 3, 2),
            C3k2Block(512, 512, n=2, shortcut=True),
        )

        # P5（深度可分离下采样 + C3k2 + SPPF + C2PSA）
        self.p5 = nn.Sequential(
            DSConv(512, 1024, 3, 2),
            C3k2Block(1024, 1024, n=2, shortcut=True),
            SPPF(1024, 1024, k=5),
            C2PSA(1024),
        )

        # ── 颈部：FPN 自顶向下 ─────────────────────────────────────────────
        self.fpn_p4 = nn.Sequential(
            ConvBN(1024 + 512, 512, 1),
            C3k2Block(512, 512, n=2, shortcut=False),
        )
        self.fpn_p3 = nn.Sequential(
            ConvBN(512 + 512, 256, 1),
            C3k2Block(256, 256, n=2, shortcut=False),
        )

        # ── 颈部：PAN 自底向上 ─────────────────────────────────────────────
        self.pan_p4 = nn.Sequential(
            ConvBN(256, 256, 3, 2),
            C3k2Block(256 + 512, 512, n=2, shortcut=False),
        )
        self.pan_p5 = nn.Sequential(
            ConvBN(512, 512, 3, 2),
            C3k2Block(512 + 1024, 1024, n=2, shortcut=True),
        )

        # ── 解耦检测头（P3/P4/P5 三尺度）─────────────────────────────────
        self.head_p3 = DecoupledHead(256,  nc)   # 小目标：裂缝细节
        self.head_p4 = DecoupledHead(512,  nc)   # 中尺度：中等病害
        self.head_p5 = DecoupledHead(1024, nc)   # 大目标：坑槽

        self._init_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
            elif isinstance(m, nn.BatchNorm2d):
                nn.init.constant_(m.weight, 1)
                nn.init.constant_(m.bias, 0)

    def forward(
        self, x: torch.Tensor
    ) -> Tuple[List[torch.Tensor], List[torch.Tensor]]:
        # ── 骨干前向 ─────────────────────────────────────────────────────────
        f_stem = self.stem(x)          # P2: /4
        f_p3   = self.p3(f_stem)       # P3: /8   256ch
        f_p4   = self.p4(f_p3)         # P4: /16  512ch
        f_p5   = self.p5(f_p4)         # P5: /32  1024ch

        # ── FPN：自顶向下特征融合 ─────────────────────────────────────────
        up_p4  = F.interpolate(f_p5, scale_factor=2, mode="nearest")
        fpn_p4 = self.fpn_p4(torch.cat([up_p4, f_p4], dim=1))

        up_p3  = F.interpolate(fpn_p4, scale_factor=2, mode="nearest")
        fpn_p3 = self.fpn_p3(torch.cat([up_p3, f_p3], dim=1))

        # ── PAN：自底向上特征融合 ─────────────────────────────────────────
        pan_p4_in = self.pan_p4[0](fpn_p3)                           # 下采样
        pan_p4    = self.pan_p4[1](torch.cat([pan_p4_in, fpn_p4], dim=1))

        pan_p5_in = self.pan_p5[0](pan_p4)
        pan_p5    = self.pan_p5[1](torch.cat([pan_p5_in, f_p5], dim=1))

        # ── 解耦检测头 ────────────────────────────────────────────────────
        cls3, reg3 = self.head_p3(fpn_p3)
        cls4, reg4 = self.head_p4(pan_p4)
        cls5, reg5 = self.head_p5(pan_p5)

        cls_list = [cls3, cls4, cls5]
        reg_list = [reg3, reg4, reg5]
        return cls_list, reg_list

    def param_count(self) -> str:
        total  = sum(p.numel() for p in self.parameters())
        train  = sum(p.numel() for p in self.parameters() if p.requires_grad)
        return f"总参数量: {total/1e6:.2f}M  |  可训练: {train/1e6:.2f}M"


# ==============================================================================
# 快速验证
# ==============================================================================
if __name__ == "__main__":
    model = LSDet(nc=4, img_size=960).eval()
    print(model.param_count())

    dummy = torch.randn(1, 3, 960, 960)
    with torch.no_grad():
        cls_list, reg_list = model(dummy)

    strides = [8, 16, 32]
    print("\n各检测尺度输出形状：")
    for i, (cls, reg, s) in enumerate(zip(cls_list, reg_list, strides)):
        print(f"  P{i+3} (stride={s:2d}): cls={tuple(cls.shape)}  reg={tuple(reg.shape)}")
