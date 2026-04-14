from ultralytics import YOLO
if __name__ == '__main__':
    # 加载这次最新跑出来的存档
    model = YOLO("runs/train/lightscan_rdd2022_baseline/weights/last.pt")

    # 开启恢复训练
    model.train(resume=True)