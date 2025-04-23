import os
from dotenv import load_dotenv
import json
import requests

from flask import Flask, render_template, request, jsonify, Response, send_file

import cv2
import numpy as np
import geopandas as gpd
from ultralytics import YOLO

# Load environment variables from .env
load_dotenv()

# ––––– CONFIGURATION –––––
GOOGLE_STATIC_MAPS_URL = "https://maps.googleapis.com/maps/api/staticmap"
API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
MODEL_PATH = "/Users/tomasarede/Desktop/arede/Projetos/ProjectRoofTops/models/best_rooftop_model.pt"

# Ensure output directories exist
os.makedirs("static/prints", exist_ok=True)
os.makedirs("static/results", exist_ok=True)

# Load YOLOv8 model
model = YOLO(MODEL_PATH)

# Initialize Flask app
app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html", api_key=API_KEY)



@app.route("/capture", methods=["POST"])
def capture():
    """
    Given center coordinates and zoom, fetch a Static Maps image,
    run YOLOv8 inference (conf >= 0.5), draw aesthetic boxes and labels,
    and return the annotated PNG.
    """
    data = request.get_json()
    lat = data.get("lat")
    lng = data.get("lng")
    zoom = data.get("zoom")
    size = data.get("size", "600x400")

    if zoom < 19:
        return jsonify({"error": "Minimum zoom for capture is 19"}), 400

    params = {
        "center": f"{lat},{lng}",
        "zoom": zoom,
        "size": size,
        "maptype": "hybrid",
        "key": API_KEY,
    }

    try:
        # Fetch static map
        resp = requests.get(GOOGLE_STATIC_MAPS_URL, params=params)
        resp.raise_for_status()
        img_bytes = resp.content

        # Optionally save the raw snapshot
        raw_path = "static/prints/print.png"
        with open(raw_path, "wb") as f:
            f.write(img_bytes)

        # Decode to OpenCV image
        image = cv2.imdecode(
            np.frombuffer(img_bytes, dtype=np.uint8), cv2.IMREAD_COLOR
        )

        # YOLO inference
        results = model.predict(source=image, conf=0.3)[0]
        accent = (77, 157, 224)  

        for box in results.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            conf = float(box.conf[0])
            if conf < 0.3:
                continue

            # semi-transparent fill
            overlay = image.copy()
            cv2.rectangle(overlay, (x1, y1), (x2, y2), accent, thickness=-1)
            image = cv2.addWeighted(overlay, 0.3, image, 0.7, 0)

            # anti-aliased border
            cv2.rectangle(
                image, (x1, y1), (x2, y2), accent, thickness=3, lineType=cv2.LINE_AA
            )

            # solid background for label
            label = f"{conf:.2f}"
            (tw, th), baseline = cv2.getTextSize(
                label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2
            )
            rect_tl = (x1, y1 - th - baseline - 4)
            rect_br = (x1 + tw + 6, y1)
            cv2.rectangle(image, rect_tl, rect_br, accent, thickness=-1)

            # anti-aliased white text
            text_org = (x1 + 3, y1 - baseline - 2)
            cv2.putText(
                image,
                label,
                text_org,
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2,
                lineType=cv2.LINE_AA,
            )

        annotated_path = "static/results/annotated.png"
        cv2.imwrite(annotated_path, image)
        return send_file(annotated_path, mimetype="image/png")

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)