# routes/media_to_mp3.py
from flask import Blueprint, current_app
from app_utils import *
import logging
from services.ffmpeg_toolkit import process_conversion
from services.authentication import authenticate
from services.cloud_storage import upload_file
import os

convert_bp = Blueprint('convert', __name__)
logger = logging.getLogger(__name__)

@convert_bp.route('/media-to-mp3', methods=['POST'])
@authenticate
@validate_payload({
    "type": "object",
    "properties": {
        "media_url": {"type": "string", "format": "uri"},
        "webhook_url": {"type": "string", "format": "uri"},
        "id": {"type": "string"},
        "bitrate": {"type": "string", "pattern": "^[0-9]+k$"}
    },
    "required": ["media_url"],
    "additionalProperties": False
})
@queue_task_wrapper(bypass_queue=False)
def convert_media_to_mp3(job_id, data):
    media_url = data['media_url']
    webhook_url = data.get('webhook_url')
    id = data.get('id')
    bitrate = data.get('bitrate', '128k')

    logger.info(f"Job {job_id}: Received media-to-mp3 request for media URL: {media_url}")

    try:
        output_file = process_conversion(media_url, job_id, bitrate)
        logger.info(f"Job {job_id}: Media conversion process completed successfully")

        cloud_url = upload_file(output_file)
        logger.info(f"Job {job_id}: Converted media uploaded to cloud storage: {cloud_url}")

        return cloud_url, "/media-to-mp3", 200

    except Exception as e:
        logger.error(f"Job {job_id}: Error during media conversion process - {str(e)}")
        return str(e), "/media-to-mp3", 500