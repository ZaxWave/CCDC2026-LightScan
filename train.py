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
import os
from pathlib import Path
from ultralytics import YOLO

os.environ['OMP_NUM_THREADS'] = '8'

ROOT = Path(__file__).resolve().parent

def train(smoke_test=False):
    model = YOLO(str(ROOT / "models" / "yolo11s.pt"))

    model.train(
        # 基础配置
        data=str(ROOT / "autodl-tmp"/ "datasets" / "merged" / "data.yaml"),
        project=str(ROOT / "runs" / "train"),
        name="lightscan_merged_yolo11s_v2",
        exist_ok=smoke_test,
        device=0,
        workers=12,
        cache="disk",
        amp=True,
        seed=42,

        # 核心训练超参
        epochs=2 if smoke_test else 180,
        patience=40,
        batch=32,
        imgsz=960,
        optimizer="auto",
        cos_lr=True,
        multi_scale=False,

        # Loss weights(新增 cls=0.3)
        cls=0.3,

        # 数据增强
        hsv_h=0.015, hsv_s=0.7, hsv_v=0.4,
        degrees=10.0,
        translate=0.1,
        scale=0.5,
        fliplr=0.5,
        mosaic=1.0,
        close_mosaic=10,
        mixup=0.0,
        copy_paste=0.0,
    )

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke-test", action="store_true")
    args = parser.parse_args()
    train(smoke_test=args.smoke_test)