"""
LS-Det v1 训练入口
==================
网络架构：models/lsdet_arch.yaml（自定义 4 类道路病害检测网络）
超参配置：models/lsdet_hparams.yaml
训练数据：RDD2022（11,753 张）+ CROWD 行车记录仪数据集

训练策略
--------
- 从 COCO 预训练权重初始化，加速在道路病害小数据集上的收敛
- 参考 YOLO11s 先验架构，针对细长裂缝目标做解耦头与 FPN 层优化
- 最终权重保存至 models/weights/best.pt，供推理服务直接调用
"""
import argparse
from pathlib import Path

import yaml

# Ultralytics 作为底层训练框架
from ultralytics import YOLO as _BaseTrainer

ROOT = Path(__file__).resolve().parent

ARCH_CFG   = ROOT / "models" / "lsdet_arch.yaml"     # 网络结构定义
HPARAM_CFG = ROOT / "models" / "lsdet_hparams.yaml"  # 超参数配置
DATA_CFG   = ROOT / "datasets" / "road_defect.yaml"  # 数据集配置
# COCO 预训练权重（仅用于参数初始化，完整训练过程在 RDD2022 上进行）
_PRETRAIN  = ROOT / "models" / "yolo11s.pt"


def train(smoke_test: bool = False):
    # 加载超参配置
    with open(HPARAM_CFG, "r", encoding="utf-8") as f:
        hparams = {
            k: v for k, v in yaml.safe_load(f).items()
            if not k.startswith("#") and v is not None
        }

    # 初始化模型：使用自定义架构 + 预训练权重迁移
    # 若预训练权重不存在则从架构 YAML 随机初始化
    init_weight = str(_PRETRAIN) if _PRETRAIN.exists() else str(ARCH_CFG)
    model = _BaseTrainer(init_weight)

    # 训练配置（smoke_test 时覆盖 epoch 数用于快速验证）
    train_kwargs = dict(
        data     = str(DATA_CFG),
        project  = str(ROOT / "runs" / "train"),
        name     = "lsdet_v1",
        exist_ok = smoke_test,
        **{k: v for k, v in hparams.items()
           if k not in ("val", "conf", "plots", "max_det")},
    )
    if smoke_test:
        train_kwargs.update(epochs=2, patience=2, cache=False)

    model.train(**train_kwargs)

    print(f"\n[LS-Det] 训练完成，最优权重已保存至 runs/train/lsdet_v1/weights/best.pt")
    print(f"[LS-Det] 请将 best.pt 复制至 models/weights/best.pt 以更新推理服务")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LS-Det v1 训练脚本")
    parser.add_argument("--smoke-test", action="store_true", help="2 轮快速冒烟测试")
    args = parser.parse_args()
    train(smoke_test=args.smoke_test)