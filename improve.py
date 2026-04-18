“””
LS-Det v1 微调脚本
在主训练收敛后，关闭马赛克增强，以极低学习率对最优权重进行纯净微调。
“””
from ultralytics import YOLO as _BaseTrainer

# 加载主训练阶段产生的最优权重
model = _BaseTrainer(“runs/train/lsdet_v1/weights/best.pt”)

# 关闭强增强，以极低学习率在真实图像上微调
model.train(
    data=”datasets/road_defect.yaml”,
    epochs=10,
    batch=16,
    imgsz=960,
    mosaic=0.0,
    augment=False,
    lr0=0.0001,
    name=”lsdet_v1_finetune”,
)