import argparse
from pathlib import Path
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent

def train(smoke_test=False):
    model = YOLO(str(ROOT / "models" / "yolo11n.pt"))

    model.train(
        # 1. 基础路径与环境配置
        data=str(ROOT / "datasets" / "road_defect.yaml"),
        project=str(ROOT / "runs" / "train"),
        name="lightscan_rdd2022_baseline",
        exist_ok=smoke_test,
        device=0,
        workers=4,                         # 根据ram调整
        cache="disk",
        amp=True,

        # 2. 核心训练超参数 (参考 RDD2022 论文与开源方案)
        epochs=2 if smoke_test else 300,   # RDD2022 推荐收敛轮数
        patience=50,                       # 早停机制
        batch=64,                          # 实测需要22g左右显存
        imgsz=1024,                        # 针对细小裂缝放大输入分辨率
        optimizer="auto",                  # 默认 SGD 或 AdamW
        cos_lr=True,                       # 开启余弦退火学习率

        # 3. 数据增强 (贴合道路真实物理场景)
        hsv_h=0.015, hsv_s=0.7, hsv_v=0.4, # 色彩抖动 (应对不同国家光照差异)
        degrees=10.0,                      # 随机旋转 (应对摄像头轻微倾斜)
        translate=0.1,                     # 随机平移
        scale=0.5,                         # 随机缩放
        fliplr=0.5,                        # 50% 概率水平翻转

        # 4. 复合增强与后期优化
        mosaic=1.0,                        # 开启马赛克增强
        close_mosaic=10,                   # 最后 10 轮关闭马赛克，使用真实图像微调
    )

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--smoke-test", action="store_true", help="运行 2 轮快速验证")
    args = parser.parse_args()
    train(smoke_test=args.smoke_test)