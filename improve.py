from ultralytics import YOLO

# 1. 加载刚才那个因为早停而产生的最高分模型
model = YOLO("runs/train/lightscan_rdd2022_baseline/weights/best.pt")

# 2. 强制进行 10 轮“纯净微调”
model.train(
    data="datasets/road_defect.yaml",
    epochs=10,             # 只跑 10 轮
    batch=32,              
    imgsz=1024,
    mosaic=0.0,            # 关键：彻底关掉马赛克
    augment=False,         # 关掉其他复杂的空间增强
    lr0=0.0001,            # 关键：学习率调到极低，只做微调，不搞大破坏
    name="lightscan_finetune_10epochs"
)