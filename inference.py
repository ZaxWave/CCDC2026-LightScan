import cv2
import torch
from ultralytics import YOLO

class LightScanInference:
    """
    LightScan 推理核心类
    职责：加载模型权重、执行图像推断、结构化输出结果
    """
    def __init__(self, model_path="models/weights/best.pt", device=None):
        # 自动选择设备: 有 GPU 用 GPU, 否则用 CPU
        if device is None:
            self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        else:
            self.device = device
            
        # 预加载模型，避免重复 IO
        self.model = YOLO(model_path)
        print(f"✅ 模型已加载至设备: {self.device}")

    def run(self, source, conf=0.25):
        """
        执行推理
        :param source: 图像路径、PIL图像、或 NumPy 数组
        :param conf: 置信度阈值
        :return: Ultralytics Results 对象
        """
        results = self.model.predict(
            source=source,
            conf=conf,
            device=self.device,
            save=False  # 生产环境下通常不自动保存图片，由后端控制
        )
        return results[0]

# --- 独立测试逻辑 ---
if __name__ == "__main__":
    # 仅当直接运行此脚本时执行，方便开发者快速验证模型
    engine = LightScanInference()
    # 模拟一张图片进行测试
    # test_img = "data/raw/sample.jpg"
    # result = engine.run(test_img)
    # result.show()