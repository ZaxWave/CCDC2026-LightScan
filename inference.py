import cv2
import torch
import numpy as np
from pathlib import Path
from sahi import AutoDetectionModel
from sahi.predict import get_sliced_prediction

ROOT = Path(__file__).resolve().parent

class LightScanInference:
    """
    视觉推理核心引擎。
    集成 SAHI (Slicing Aided Hyper Inference) 框架，
    实现对高分辨率图像中微小目标及细长拓扑结构（如裂缝）的增强检测。
    """
    def __init__(self, model_path=None, device=None):
        if model_path is None:
            model_path = ROOT / "models" / "weights" / "best.pt"
            
        # 硬件加速设备选择策略
        if device is None:
            self.device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
        else:
            self.device = device
            
        # 初始化 SAHI 推理封装
        # model_type='yolov8' 为 SAHI 框架的兼容性参数，适配所有 Ultralytics PT 格式权重
        self.model = AutoDetectionModel.from_pretrained(
            model_type='yolov8',
            model_path=str(model_path),
            confidence_threshold=0.25, 
            device=self.device, 
        )
  
    def run(self, source, conf=0.25):
        """
        执行推理流程。
        应用动态自适应切片策略及宏微观双重融合匹配，优化小目标召回率。
        """
        # 动态更新置信度阈值
        self.model.confidence_threshold = conf
        
        # 解析输入图像分辨率
        if isinstance(source, np.ndarray):
            img_h, img_w = source.shape[:2]
        else:
            temp_img = cv2.imread(str(source))
            img_h, img_w = temp_img.shape[:2]

        # 计算自适应切片参数
        # 策略目标：在保留上下文语义信息与放大局部特征之间取得平衡
        
        if img_w <= 640 and img_h <= 640:
            # 低分辨率图像：禁用切片，执行全局推理，通过内部上采样增强特征提取
            slice_w, slice_h = 640, 640 
            overlap_w, overlap_h = 0.0, 0.0

        elif img_w <= 1280 and img_h <= 1280:
            # 标准高清图像：采用 512x512 切片尺寸，提高重叠率以降低目标截断风险
            slice_w, slice_h = 512, 512
            overlap_w, overlap_h = 0.25, 0.25 
            
        else:
            # 超高清大图：采用 640x640 切片尺寸，控制切片总数及推理算力消耗
            slice_w, slice_h = 640, 640
            overlap_w, overlap_h = 0.2, 0.2

        # 执行带有切片辅助与全局融合的预测
        results = get_sliced_prediction(
            source,
            self.model,
            slice_height=slice_h,
            slice_width=slice_w,
            overlap_height_ratio=overlap_h,
            overlap_width_ratio=overlap_w,
            
            # 开启全局标准预测融合，保留跨切片的宏观结构特征
            perform_standard_pred=True, 
            
            # 后处理合并配置
            # NMM (Non-Maximum Merging) 策略合并相交边界框
            postprocess_type="NMM",   
            
            # 采用 IOS (Intersection Over Smaller Area) 匹配矩阵，优化细长型目标的合并效果
            postprocess_match_metric="IOS", 
            postprocess_match_threshold=0.3 
        )
        
        return results