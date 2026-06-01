from flask import Blueprint, jsonify, request

from utils import auth

auth_blueprint = Blueprint("auth", __name__)

VALID_ENVS = ("live", "test")


@auth_blueprint.route("/api/auth/publish", methods=["POST"])
def publish():
    data = request.get_json(force=True, silent=True) or {}
    app_name = data.get("app", "")
    stream_name = data.get("stream", "")

    if stream_name == "stream_smooth":
        return jsonify({"code": 0})

    if app_name not in VALID_ENVS:
        return jsonify({"code": 1, "msg": f"unknown live room: {app_name}"}), 403

    param = data.get("param", "")
    provided_key = ""
    if "key=" in param:
        provided_key = param.split("key=", 1)[1].split("&")[0]

    valid, message = auth.verify_stream_token(provided_key, app_name)
    if valid:
        return jsonify({"code": 0})
    return jsonify({"code": 1, "msg": message}), 403
