"""
Framecraft Distribution Microservice — Instagram Auto-Poster
Requires: pip install flask instagrapi

Run locally alongside Framecraft:
  export IG_USERNAME="your_handle"
  export IG_PASSWORD="your_password"
  python ig_poster.py
"""

import os
from flask import Flask, jsonify, request
from instagrapi import Client

app = Flask(__name__)
cl = Client()

SESSION_FILE = "session.json"


def ensure_session() -> None:
    if os.path.exists(SESSION_FILE):
        cl.load_settings(SESSION_FILE)
    username = os.environ.get("IG_USERNAME")
    password = os.environ.get("IG_PASSWORD")
    if not username or not password:
        raise RuntimeError(
            "Set IG_USERNAME and IG_PASSWORD environment variables before starting ig_poster.py."
        )
    cl.login(username, password)
    cl.dump_settings(SESSION_FILE)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True})


@app.route("/post", methods=["POST"])
def post_to_ig():
    data = request.get_json(silent=True) or {}
    image_path = data.get("image_path")
    caption = data.get("caption", "New shoot out now. Link in bio.")

    if not image_path or not os.path.exists(image_path):
        return jsonify({"success": False, "error": f"Image file not found: {image_path}"}), 400

    try:
        ensure_session()
        media = cl.photo_upload(path=image_path, caption=caption)
        code = getattr(media, "code", "")
        url = f"https://www.instagram.com/p/{code}/" if code else str(getattr(media, "pk", ""))
        return jsonify({"success": True, "url": url})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001)
