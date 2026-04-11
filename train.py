from ultralytics import YOLO

def train():
    # 初始化模型（可以是 yolo11n.pt 或 配置文件）
    model = YOLO("yolo11n.pt") 

    # 核心训练参数
    model.train(
        data="datasets/road_defect.yaml", # 关键：数据集定义
        epochs=100,
        imgsz=640,
        batch=16,
        project="runs/train",             # 结果统一存放在 runs
        name="lightscan_exp",
        device=0                          # 0 代表 GPU，'cpu' 代表 CPU
    )

if __name__ == "__main__":
    train()