"""LS-Det v1 断点续训入口。"""
from ultralytics import YOLO as _BaseTrainer

if __name__ == '__main__':
    model = _BaseTrainer("runs/train/lsdet_v1/weights/last.pt")
    model.train(resume=True)