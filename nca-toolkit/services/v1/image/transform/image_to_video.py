import os
import subprocess
import logging
from services.file_management import download_file
from PIL import Image
import tempfile
import shutil

STORAGE_PATH = "/tmp/"
logger = logging.getLogger(__name__)

def process_image_to_video(image_url, length, frame_rate, zoom_speed, zoom_x, zoom_y, filename, webhook_url=None):
    try:
        # Download the image file
        image_path = download_file(image_url, STORAGE_PATH)
        logger.info(f"Downloaded image to {image_path}")

        # Get image dimensions using Pillow
        with Image.open(image_path) as img:
            width, height = img.size
        logger.info(f"Original image dimensions: {width}x{height}")

        # Prepare the output path
        output_path = os.path.join(STORAGE_PATH, f"{filename}.mp4")

        # Determine orientation and set appropriate dimensions
        if width > height:
            scale_dims = "7680:4320"
            output_dims = "1920x1080"
        else:
            scale_dims = "4320:7680"
            output_dims = "1080x1920"

        # Determine focus point in scalated
        if zoom_x != "iw/2":
            zoom_x = zoom_x*4
        if zoom_y != "ih/2":
            zoom_y = zoom_y*4

        # Calculate total frames and zoom factor
        total_frames = int(length * frame_rate)
        zoom_factor = 1 + (zoom_speed * length)

        logger.info(f"Using scale dimensions: {scale_dims}, output dimensions: {output_dims}")
        logger.info(f"Video length: {length}s, Frame rate: {frame_rate}fps, Total frames: {total_frames}")
        logger.info(f"Zoom speed: {zoom_speed}/s, Final zoom factor: {zoom_factor}")
        logger.info(f"Zoom focal point: X={zoom_x}, Y={zoom_y}")

        # Prepare FFmpeg command
        cmd = [
            'ffmpeg', '-framerate', str(frame_rate), '-loop', '1', '-i', image_path,
            '-vf', f"scale={scale_dims},zoompan=z='min(1+({zoom_speed}*{length})*on/{total_frames}, {zoom_factor})':d={total_frames}:x='{zoom_x}-(iw/zoom/2)':y='{zoom_y}-(ih/zoom/2)':s={output_dims}",
            '-c:v', 'libx264', '-t', str(length), '-pix_fmt', 'yuv420p', output_path
        ]

        logger.info(f"Running FFmpeg command: {' '.join(cmd)}")

        # Run FFmpeg command
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error(f"FFmpeg command failed. Error: {result.stderr}")
            raise subprocess.CalledProcessError(result.returncode, cmd, result.stdout, result.stderr)

        logger.info(f"Video created successfully: {output_path}")

        # Clean up input file
        os.remove(image_path)

        return output_path
    except Exception as e:
        logger.error(f"Error in process_image_to_video: {str(e)}", exc_info=True)
        raise

def process_image_to_video_2segments(image_url, length, frame_rate, zoom_speed, zoom_x, zoom_y, filename, webhook_url=None):
    try:
        # Download the image file
        image_path = download_file(image_url, STORAGE_PATH)
        logger.info(f"Downloaded image to {image_path}")

        # Get image dimensions using Pillow
        with Image.open(image_path) as img:
            width, height = img.size
        logger.info(f"Original image dimensions: {width}x{height}")

        # Create temporary directory for segments
        temp_dir = tempfile.mkdtemp(dir=STORAGE_PATH)
        
        # Determine orientation and set appropriate dimensions
        if width > height:
            scale_dims = "7680:4320"
            output_dims = "1920x1080"
        else:
            scale_dims = "4320:7680"
            output_dims = "1080x1920"
            
        # Calculate parameters
        total_frames = int(length * frame_rate)
        segment_frames = int(length * frame_rate / 2)
        segment_length = segment_frames / frame_rate
        
        # Ensure target coordinates are scaled properly
        target_x = zoom_x if isinstance(zoom_x, str) else zoom_x * 4
        target_y = zoom_y if isinstance(zoom_y, str) else zoom_y * 4
        
        # Final output path
        final_output_path = os.path.join(STORAGE_PATH, f"{filename}.mp4")
        
        # Create segment 1: Zoom in from center
        segment1_path = os.path.join(temp_dir, "segment1.mp4")
        zoom_factor_end = 1 + (zoom_speed * segment_length)
        
        cmd1 = [
            'ffmpeg', '-framerate', str(frame_rate), '-loop', '1', '-i', image_path,
            '-vf', f"scale={scale_dims},zoompan=z='1+({zoom_speed}*{segment_length})*on/{segment_frames}':d={segment_frames}:x='(iw/2)-(iw/zoom/2)':y='(ih/2)-(ih/zoom/2)':s={output_dims}",
            '-c:v', 'libx264', '-t', str(segment_length), '-pix_fmt', 'yuv420p', segment1_path
        ]
        
        logger.info(f"Running FFmpeg command for segment 1 (zoom in): {' '.join(cmd1)}")
        subprocess.run(cmd1, check=True, capture_output=True, text=True)
        
        # Create segment 2: Zoom out
        segment2_path = os.path.join(temp_dir, "segment2.mp4")
        
        cmd2 = [
            'ffmpeg', '-framerate', str(frame_rate), '-loop', '1', '-i', image_path,
            '-vf', f"scale={scale_dims},zoompan=z='{zoom_factor_end}-({zoom_speed}*{segment_length})*on/{segment_frames}':d={segment_frames}:x='(iw/2)-(iw/zoom/2)':y='(ih/2)-(ih/zoom/2)':s={output_dims}",
            '-c:v', 'libx264', '-t', str(segment_length), '-pix_fmt', 'yuv420p', segment2_path
        ]
        
        logger.info(f"Running FFmpeg command for segment 2 (zoom out): {' '.join(cmd2)}")
        subprocess.run(cmd2, check=True, capture_output=True, text=True)
        
        # Create a file listing the segments
        list_file = os.path.join(temp_dir, "file_list.txt")
        with open(list_file, 'w') as f:
            f.write(f"file '{segment1_path}'\n")
            f.write(f"file '{segment2_path}'\n")
        
        # Concatenate all segments
        concat_cmd = [
            'ffmpeg', '-f', 'concat', '-safe', '0', '-i', list_file, 
            '-c', 'copy', final_output_path
        ]
        
        logger.info(f"Running FFmpeg command to concatenate segments: {' '.join(concat_cmd)}")
        subprocess.run(concat_cmd, check=True, capture_output=True, text=True)
        
        logger.info(f"Video created successfully: {final_output_path}")
        
        # Clean up temporary files
        os.remove(image_path)
        shutil.rmtree(temp_dir)
        
        return final_output_path
        
    except Exception as e:
        logger.error(f"Error in process_image_to_video_2segments: {str(e)}", exc_info=True)
        raise