"""
tools/convert_voc_to_yolo.py
将 RDD2022 VOC 格式标注转换为 YOLO 格式，合并三个子集到统一输出目录。

用法:
    python tools/convert_voc_to_yolo.py --dry-run   # 预检，只扫描不写文件
    python tools/convert_voc_to_yolo.py             # 正式转换
"""

import argparse
import random
import shutil
import time
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

from tqdm import tqdm

# ── 常量配置 ──────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATASETS_DIR = PROJECT_ROOT / "datasets"

SUBSETS   = ["Japan", "China_MotorBike", "China_Drone"]  # 三个子集

LABEL_MAP = {          # 只保留这 4 类，其余全部忽略
    "D00": 0,          # 纵向裂缝 Longitudinal Crack
    "D10": 1,          # 横向裂缝 Transverse Crack
    "D20": 2,          # 龟裂     Alligator Crack
    "D40": 3,          # 坑槽     Pothole
}

OUTPUT_DIR  = DATASETS_DIR / "RDD2022_yolo"
RANDOM_SEED = 42
VAL_RATIO   = 0.2


# ── 工具函数 ──────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="RDD2022 VOC → YOLO 格式转换")
    p.add_argument("--dry-run", action="store_true",
                   help="只扫描统计，不写任何文件")
    return p.parse_args()


def parse_xml(xml_path: Path) -> list[tuple]:
    """
    解析单个 VOC XML，返回该图片的有效标注列表。
    每条为 (cls_id, x_center, y_center, width, height)，已归一化到 [0,1]。
    不在 LABEL_MAP 中的类别直接跳过。
    """
    root = ET.parse(xml_path).getroot()
    size = root.find("size")
    W    = int(size.findtext("width"))
    H    = int(size.findtext("height"))

    boxes = []
    for obj in root.findall("object"):
        name = obj.findtext("name")
        if name not in LABEL_MAP:
            continue                         # 忽略 D01/D43/Repair/Manhole 等

        bnd  = obj.find("bndbox")
        xmin = float(bnd.findtext("xmin"))
        ymin = float(bnd.findtext("ymin"))
        xmax = float(bnd.findtext("xmax"))
        ymax = float(bnd.findtext("ymax"))

        # 坐标越界裁剪，防止标注瑕疵导致 YOLO 训练报错
        xmin = max(0.0, min(xmin, W))
        ymin = max(0.0, min(ymin, H))
        xmax = max(0.0, min(xmax, W))
        ymax = max(0.0, min(ymax, H))

        if xmax <= xmin or ymax <= ymin:
            continue                         # 裁剪后仍为无效框，跳过

        # 转 YOLO 归一化格式
        x_c = (xmin + xmax) / 2 / W
        y_c = (ymin + ymax) / 2 / H
        bw  = (xmax - xmin) / W
        bh  = (ymax - ymin) / H
        boxes.append((LABEL_MAP[name], x_c, y_c, bw, bh))

    return boxes


# ── 主流程 ────────────────────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()
    t0   = time.time()

    # ── 1. 预检：打印将要处理的目录 ───────────────────────────────────────────
    print("将要处理的子集目录：")
    for subset in SUBSETS:
        xml_dir = DATASETS_DIR / subset / "train" / "annotations" / "xmls"
        exists  = "[OK]" if xml_dir.exists() else "[缺失]"
        n       = len(list(xml_dir.glob("*.xml"))) if xml_dir.exists() else 0
        print(f"  {exists}  {xml_dir}  ({n} 个 xml)")
    print()

    # ── 2. 扫描所有子集，收集有效样本 ─────────────────────────────────────────
    samples   = []                    # [(subset_name, img_path, boxes), ...]
    cls_count = defaultdict(int)
    total_xml = 0

    for subset in SUBSETS:
        xml_dir = DATASETS_DIR / subset / "train" / "annotations" / "xmls"
        img_dir = DATASETS_DIR / subset / "train" / "images"

        if not xml_dir.exists():
            continue

        xml_files  = sorted(xml_dir.glob("*.xml"))
        total_xml += len(xml_files)

        for xml_path in tqdm(xml_files, desc=f"扫描 {subset}", unit="xml"):
            img_path = img_dir / xml_path.with_suffix(".jpg").name
            if not img_path.exists():
                continue              # 对应图片缺失，跳过

            boxes = parse_xml(xml_path)
            # boxes 为空 = 负样本（无目标类别），保留以减少误报
            for cls_id, *_ in boxes:
                cls_count[cls_id] += 1

            samples.append((subset, img_path, boxes))

    # ── 3. 统计汇总 ────────────────────────────────────────────────────────────
    cls_names  = {0: "D00", 1: "D10", 2: "D20", 3: "D40"}
    n_neg      = sum(1 for _, _, b in samples if not b)   # 负样本数量
    n_val_est  = int(len(samples) * VAL_RATIO)
    print(f"\n{'='*55}")
    print(f"  扫描 XML 总数:    {total_xml}")
    print(f"  有效图片（含负样本）: {len(samples)}")
    print(f"    其中负样本:     {n_neg}")
    print(f"  预计 train/val:   {len(samples)-n_val_est} / {n_val_est}")
    print(f"  各类别标注数量:")
    for cid, cname in cls_names.items():
        print(f"    [{cid}] {cname}: {cls_count[cid]}")
    print(f"  输出目录: {OUTPUT_DIR}")
    print(f"{'='*55}")

    if args.dry_run:
        print("\n[dry-run] 扫描完毕，未写任何文件。")
        print("确认无误后去掉 --dry-run 正式运行。\n")
        return

    # ── 4. 划分 train / val（固定随机种子保证复现） ───────────────────────────
    rng = random.Random(RANDOM_SEED)
    rng.shuffle(samples)
    n_val   = int(len(samples) * VAL_RATIO)
    val_idx = set(range(len(samples) - n_val, len(samples)))

    # ── 5. 创建输出目录结构 ────────────────────────────────────────────────────
    for split in ("train", "val"):
        (OUTPUT_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (OUTPUT_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

    # ── 6. 写图片 + 标注文件 ───────────────────────────────────────────────────
    n_train = n_val_out = 0
    for idx, (subset, img_path, boxes) in enumerate(
        tqdm(samples, desc="写出文件", unit="img")
    ):
        split = "val" if idx in val_idx else "train"
        stem  = f"{subset}_{img_path.stem}"            # 加子集前缀防重名

        shutil.copy2(img_path,
                     OUTPUT_DIR / "images" / split / f"{stem}.jpg")

        lbl_path = OUTPUT_DIR / "labels" / split / f"{stem}.txt"
        with lbl_path.open("w") as f:
            for cls_id, x_c, y_c, bw, bh in boxes:
                f.write(f"{cls_id} {x_c:.6f} {y_c:.6f} {bw:.6f} {bh:.6f}\n")

        if split == "val":
            n_val_out += 1
        else:
            n_train += 1

    # ── 7. 完成统计 ────────────────────────────────────────────────────────────
    elapsed = time.time() - t0
    print(f"\n{'='*55}")
    print(f"  转换完成！耗时 {elapsed:.1f}s")
    print(f"  train: {n_train} 张    val: {n_val_out} 张")
    print(f"  输出目录: {OUTPUT_DIR}")
    print(f"{'='*55}\n")


if __name__ == "__main__":
    main()
