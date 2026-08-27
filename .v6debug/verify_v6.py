import math
import cv2
import numpy as np
import onnxruntime as ort
import pyclipper
from PIL import Image, ImageDraw, ImageFont

ONNX_DIR = "/tmp/v6"
DET = ort.InferenceSession(f"{ONNX_DIR}/PP-OCRv6_det_tiny.onnx", providers=["CPUExecutionProvider"])
REC = ort.InferenceSession(f"{ONNX_DIR}/PP-OCRv6_rec_tiny.onnx", providers=["CPUExecutionProvider"])
CLS = ort.InferenceSession(f"{ONNX_DIR}/cls.onnx", providers=["CPUExecutionProvider"])

PADDING = 50
BOX_SCORE_THRESH = 0.5
BOX_THRESH = 0.3
UNCLIP_RATIO = 1.6
DO_ANGLE = False

DET_MEAN = np.array([0.485 * 255, 0.456 * 255, 0.406 * 255], dtype=np.float32)
DET_NORM = np.array([1.0 / 0.229 / 255, 1.0 / 0.224 / 255, 1.0 / 0.225 / 255], dtype=np.float32)
REC_MEAN = np.array([127.5, 127.5, 127.5], dtype=np.float32)
REC_NORM = np.array([1.0 / 127.5, 1.0 / 127.5, 1.0 / 127.5], dtype=np.float32)

meta = REC.get_modelmeta().custom_metadata_map
character = meta["character"]
keys = ["#"]
keys.extend(character.split("\n"))
keys.append(" ")


def gen_test_image(path="/tmp/v6/gen_test.png"):
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 40)
    img = Image.new("RGB", (760, 300), (255, 255, 255))
    d = ImageDraw.Draw(img)
    lines = [
        "https://github.com/RapidAI/RapidOCR",
        "v3.9.2 PP-OCRv6 tiny models",
        "Hello World 123 ABC 2026",
    ]
    y = 30
    for line in lines:
        d.text((20, y), line, fill=(0, 0, 0), font=font)
        y += 80
    img.save(path)
    return img


def get_scale_param(src_w, src_h, max_side_val):
    origin_max_side = max(src_w, src_h)
    target = origin_max_side if (max_side_val == 0 or max_side_val > origin_max_side) else max_side_val
    target += 2 * PADDING
    if src_w > src_h:
        ratio = target / src_w
    else:
        ratio = target / src_h
    dst_w = int(src_w * ratio)
    dst_h = int(src_h * ratio)
    if dst_w % 32 != 0:
        dst_w = (dst_w // 32) * 32
        dst_w = max(dst_w, 32)
    if dst_h % 32 != 0:
        dst_h = (dst_h // 32) * 32
        dst_h = max(dst_h, 32)
    sw = dst_w / src_w
    sh = dst_h / src_h
    return dst_w, dst_h, sw, sh


def get_rotate_crop_image(img_np, points):
    pts = [tuple(p) for p in points]
    min_x = max(0, min(p[0] for p in pts))
    min_y = max(0, min(p[1] for p in pts))
    max_x = min(img_np.shape[1] - 1, max(p[0] for p in pts))
    max_y = min(img_np.shape[0] - 1, max(p[1] for p in pts))
    crop = img_np[min_y:max_y + 1, min_x:max_x + 1].copy()
    pts = [(p[0] - min_x, p[1] - min_y) for p in pts]
    w = math.sqrt((pts[0][0] - pts[1][0]) ** 2 + (pts[0][1] - pts[1][1]) ** 2)
    h = math.sqrt((pts[0][0] - pts[3][0]) ** 2 + (pts[0][1] - pts[3][1]) ** 2)
    w, h = int(round(w)), int(round(h))
    if w <= 0 or h <= 0:
        return None
    src = np.array([pts[0], pts[1], pts[2], pts[3]], dtype=np.float32)
    dst = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(src, dst)
    part = cv2.warpPerspective(crop, m, (w, h), flags=cv2.INTER_NEAREST, borderValue=(255, 255, 255))
    if part.shape[0] >= part.shape[1] * 3 / 2:
        part = cv2.rotate(part, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return part


def unclip(box, ratio):
    pts = np.array(box, dtype=np.float32)
    area = abs(cv2.contourArea(pts))
    perim = cv2.arcLength(pts, True)
    distance = area * ratio / perim
    pc = pyclipper.PyclipperOffset()
    pc.AddPath([tuple(int(v) for v in p) for p in pts], pyclipper.JT_ROUND, pyclipper.ET_CLOSEDPOLYGON)
    sol = pc.Execute(distance)
    return sol


def score(map_, contour):
    mask = np.zeros(map_.shape[:2], dtype=np.uint8)
    cv2.drawContours(mask, [contour.astype(np.int32)], -1, 255, -1)
    return float(map_[mask > 0].mean())


def get_mini_box(points):
    box = cv2.boxPoints(cv2.minAreaRect(np.asarray(points, dtype=np.float32)))
    box = box[np.argsort(box[:, 0])]
    index_1 = 0 if box[1][1] > box[0][1] else 1
    index_4 = 1 if box[1][1] > box[0][1] else 0
    index_2 = 2 if box[3][1] > box[2][1] else 3
    index_3 = 3 if box[3][1] > box[2][1] else 2
    return box[[index_1, index_2, index_3, index_4]]


def detect_postprocess(pred0, sw, sh, src_w, src_h):
    cbuf = np.clip(pred0 * 255, 0, 255).astype(np.uint8)
    _, thresh = cv2.threshold(cbuf, BOX_THRESH * 255, 255, cv2.THRESH_BINARY)
    kernel = np.ones((3, 3), np.uint8)
    dilate = cv2.dilate(thresh, kernel, iterations=1)
    contours, _ = cv2.findContours(dilate, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    boxes = []
    for contour in contours:
        if len(contour) <= 2:
            continue
        box = cv2.boxPoints(cv2.minAreaRect(contour.astype(np.float32)))
        max_side = max(np.linalg.norm(box[0] - box[1]), np.linalg.norm(box[1] - box[2]))
        if max_side < 3.0:
            continue
        sc = score(pred0, contour)
        if sc < BOX_SCORE_THRESH:
            continue
        sol = unclip(box, UNCLIP_RATIO)
        if not sol:
            continue
        pts = np.array(sol[0], dtype=np.float32)
        if len(pts) < 4:
            continue
        ordered = get_mini_box(pts)
        ms = max(np.linalg.norm(ordered[0] - ordered[1]), np.linalg.norm(ordered[1] - ordered[2]))
        if ms < 3.0 + 2.0:
            continue
        final = []
        for p in ordered:
            x = min(int(p[0] / sw), src_w)
            y = min(int(p[1] / sh), src_h)
            final.append((x, y))
        boxes.append((sc, final))
    boxes.sort(key=lambda b: (min(p[1] for p in b[1]), min(p[0] for p in b[1])))
    return boxes


def det(img_np, max_size):
    oh, ow = img_np.shape[:2]
    canvas = np.full((oh + 2 * PADDING, ow + 2 * PADDING, 3), 255, dtype=np.uint8)
    canvas[PADDING:PADDING + oh, PADDING:PADDING + ow] = img_np
    ch_, cw_ = canvas.shape[:2]
    flag = 0 if max_size else max_size + 2 * PADDING
    dst_w, dst_h, sw, sh = get_scale_param(cw_, ch_, flag)
    resized = cv2.resize(canvas, (dst_w, dst_h), interpolation=cv2.INTER_LINEAR)
    t = resized.astype(np.float32)
    t = t * DET_NORM - DET_MEAN * DET_NORM
    t = t.transpose(2, 0, 1)[None]
    out = DET.run(None, {"x": t.astype(np.float32)})[0]
    pred0 = out[0, 0]
    boxes = detect_postprocess(pred0, sw, sh, cw_, ch_)
    results = []
    for sc, pts in boxes:
        cub = get_rotate_crop_image(canvas, pts)
        if cub is None:
            continue
        results.append((sc, cub))
    return results


def rec(part):
    h0, w0 = part.shape[:2]
    if h0 == 0:
        return ""
    dst_h = 48
    scale = dst_h / h0
    dst_w = max(1, int(w0 * scale))
    img = Image.fromarray(part).resize((dst_w, dst_h), Image.BILINEAR)
    arr = np.asarray(img, dtype=np.float32)
    arr = arr * REC_NORM - REC_MEAN * REC_NORM
    arr = arr.transpose(2, 0, 1)[None]
    out = REC.run(None, {"x": arr.astype(np.float32)})[0]
    preds = out[0]
    text = ""
    last = 0
    for step in preds:
        idx = int(np.argmax(step))
        if idx > 0 and idx < len(keys) and not (last == idx):
            text += keys[idx]
        last = idx
    return text


def main():
    img = gen_test_image()
    src = cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2BGR)
    max_size = max(src.shape[:2])
    parts = det(src, max_size)
    print("detected blocks:", len(parts))
    for score, part in parts:
        text = rec(part)
        print("  score=%.3f text=%r" % (score, text))


if __name__ == "__main__":
    main()
