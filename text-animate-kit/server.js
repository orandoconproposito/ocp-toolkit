const express = require("express");
const { chromium } = require("playwright");
const { Storage } = require("@google-cloud/storage");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const execPromise = promisify(require("child_process").exec);

const app = express();
app.use(express.json());

// Verificar credenciales al inicio
let storage;
try {
    console.log("Inicializando Storage client...");
    storage = new Storage({
        credentials: JSON.parse(process.env.GCP_SA_CREDENTIALS)
    });
    console.log("Storage client inicializado correctamente");
} catch (error) {
    console.error("Error al inicializar Storage client:", error);
    throw error;
}

const bucketName = process.env.GCP_BUCKET_NAME;
console.log("Bucket configurado:", bucketName);

app.post("/text/title", async (req, res) => {
    console.log("Recibida nueva solicitud POST /text/title");
    console.log("Body de la solicitud:", JSON.stringify(req.body));
    
    let browser = null;
    let framesDir = null;
    
    try {
        // Validación de parámetros
        console.log("Validando parámetros...");
        const requiredParams = [
            "text",
            "initial_delay",
            "fade_in_duration",
            "fade_out_start",
            "fade_out_duration",
            "overlap_factor",
            "output_file_name"
        ];
        
        const missingParams = requiredParams.filter(param => req.body[param] === undefined);
        if (missingParams.length > 0) {
            console.error("Parámetros faltantes:", missingParams);
            return res.status(400).json({
                error: `Faltan parámetros requeridos: ${missingParams.join(", ")}`
            });
        }

        const {
            text,
            initial_delay,
            fade_in_duration,
            fade_out_start,
            fade_out_duration,
            overlap_factor,
            output_file_name
        } = req.body;

        // Iniciar Playwright
        console.log("Iniciando Playwright...");
        browser = await chromium.launch();
        console.log("Playwright iniciado correctamente");

        const context = await browser.newContext();
        const page = await context.newPage();
        console.log("Nueva página creada");
        
        await page.setViewportSize({
            width: 1920,
            height: 1080
        });
        console.log("Viewport configurado");

        // Configurar el HTML (mismo HTML que antes...)
        console.log("Configurando contenido HTML...");
        const html = `<!DOCTYPE html>
        <html>
        <head>
            <link href="https://fonts.cdnfonts.com/css/metropolis-2" rel="stylesheet">
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    background: transparent;
                }
                .text-container {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    font-family: 'Metropolis';
                    font-weight: 900;
                    font-size: 160px;
                    color: #a44100;
                    text-align: center;
                    letter-spacing: 1px;
                    line-height: 1.1;
                    width: 100%;
                    text-shadow: 5px 5px 5px rgba(0, 0, 0, 0.3);
                    -webkit-text-stroke: 8px white;
                    white-space: pre-line;
                }
                .letter { display: inline-block; }
            </style>
        </head>
        <body>
            <div class="text-container" id="text"></div>
            <script>
                const text = \`${text}\`;
                const container = document.getElementById('text');
                const lines = text.split('\\n');
                
                lines.forEach((line, lineIndex) => {
                    if (lineIndex > 0) container.appendChild(document.createElement('br'));
                    [...line].forEach(char => {
                        const span = document.createElement('span');
                        span.textContent = char === ' ' ? '\\u00A0' : char;
                        span.className = 'letter';
                        span.style.opacity = '0';
                        container.appendChild(span);
                    });
                });
            </script>
        </body>
        </html>`;

        await page.setContent(html);
        console.log("Contenido HTML configurado");

        // Esperar a que la fuente se cargue y el contenido esté listo
        await page.waitForFunction(() => document.fonts.ready);
        console.log("Espera de cargue de fuente completada");

        // Generar frames
        console.log("Iniciando generación de frames...");
        framesDir = path.join("/tmp", "frames");
        if (!fs.existsSync(framesDir)) {
            fs.mkdirSync(framesDir, { recursive: true });
        }
        console.log("Directorio de frames creado:", framesDir);

        // Calcular parámetros de animación
        const totalTime = fade_out_start + fade_out_duration;
        const fps = 30;
        const totalFrames = Math.ceil(totalTime * fps);
        const letters = await page.$$('.letter');
        const lettersCount = letters.length;
        const fadeInPerLetter = (fade_in_duration * overlap_factor) / lettersCount;
        console.log(`Tiempo total de animación: ${totalTime}s`);
        console.log(`Número total de frames a capturar: ${totalFrames}`);

        // Generar cada frame
        for (let frame = 0; frame < totalFrames; frame++) {
            const currentTime = frame / fps;
            
            // Calcular opacidad para cada letra
            await page.evaluate(({
                currentTime, 
                initial_delay, 
                fadeInPerLetter, 
                lettersCount, 
                fade_out_start, 
                fade_out_duration,
                overlap_factor
            }) => {
                const letters = document.querySelectorAll('.letter');
                letters.forEach((letter, index) => {
                    // Fade in
                    let opacity = 0;
                    const letterStartTime = initial_delay + (index * fadeInPerLetter);
                    if (currentTime > letterStartTime) {
                        opacity = Math.min(1, (currentTime - letterStartTime) / (fadeInPerLetter / overlap_factor));
                    }
                    
                    // Fade out
                    if (currentTime >= fade_out_start) {
                        const fadeOutProgress = (currentTime - fade_out_start) / fade_out_duration;
                        opacity *= (1 - fadeOutProgress);
                    }
                    
                    letter.style.opacity = opacity;
                });
            }, {
                currentTime,
                initial_delay,
                fadeInPerLetter,
                lettersCount,
                fade_out_start,
                fade_out_duration,
                overlap_factor
            });


            // Capturar frames
            const framePath = `${framesDir}/frame-${String(frame).padStart(3, "0")}.png`;
            await page.screenshot({
                path: framePath,
                omitBackground: true
            });
        }
        console.log("Generación de frames completada");

        // Generar video con FFmpeg
        console.log("Iniciando generación de video...");
        const outputFilePath = path.join("/tmp", output_file_name);
        
        console.log("Ejecutando FFmpeg...");
        await execPromise(`ffmpeg -framerate ${fps} -i ${framesDir}/frame-%03d.png \
            -c:v libvpx-vp9 \
            -pix_fmt yuva420p \
            -metadata:s:v:0 alpha_mode="1" \
            -b:v 2M \
            -deadline best \
            -cpu-used 0 \
            -row-mt 1 \
            -f webm \
            ${outputFilePath}`);
        console.log("Video generado");

        // Verificar la transparencia del WebM
        console.log("Verificando transparencia del WebM...");
        const { stdout: ffprobeOutput } = await execPromise(`ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of default=noprint_wrappers=1:nokey=1 ${outputFilePath}`);
        const pixelFormat = ffprobeOutput.trim();
        console.log("Formato de píxeles del WebM:", pixelFormat);
        const hasTransparency = pixelFormat === 'yuva420p';
        console.log("¿El WebM tiene canal alpha?", hasTransparency);

        // Subir a GCS
        console.log("Iniciando subida a Google Cloud Storage...");
        await storage.bucket(bucketName).upload(outputFilePath, {
            destination: output_file_name
        });
        console.log("Archivo subido a GCS");

        // Limpieza
        console.log("Iniciando limpieza de archivos...");
        await browser.close();
        fs.unlinkSync(outputFilePath);
        fs.rmSync(framesDir, { recursive: true, force: true });
        console.log("Limpieza completada");

        res.json({
            message: "Success",
            webm_url: `https://storage.googleapis.com/${bucketName}/${output_file_name}`,
            webm_transparency: {
                pixel_format: pixelFormat,
                has_alpha: hasTransparency
            }
        });
        console.log("Respuesta enviada con éxito");

    } catch (error) {
        console.error("Error en el procesamiento:", error);
        console.error("Stack trace:", error.stack);
        
        // Limpieza en caso de error
        try {
            if (browser) {
                console.log("Cerrando navegador después de error...");
                await browser.close();
                console.log("Navegador cerrado después de error");
            }
            if (framesDir && fs.existsSync(framesDir)) {
                console.log("Limpiando directorio de frames después de error...");
                fs.rmSync(framesDir, { recursive: true, force: true });
                console.log("Directorio de frames limpiado después de error");
            }
        } catch (cleanupError) {
            console.error("Error durante la limpieza:", cleanupError);
        }
        
        res.status(500).json({
            error: "Error en el procesamiento",
            details: error.message
        });
    }
});

app.post("/text/png", async (req, res) => {
    console.log("Recibida nueva solicitud POST /text/png");
    console.log("Body de la solicitud:", JSON.stringify(req.body));
    
    let browser = null;
    
    try {
        // Validación de parámetros
        console.log("Validando parámetros...");
        const requiredParams = [
            "text",
            "output_file_name",
            "font_size",
            "font_color",
            "letter_spacing",
            "line_height",
            "padding",
            "shadow_size",
            "shadow_opacity",
            "stroke_size",
            "stroke_color"
        ];
        
        const missingParams = requiredParams.filter(param => req.body[param] === undefined);
        if (missingParams.length > 0) {
            console.error("Parámetros faltantes:", missingParams);
            return res.status(400).json({
                error: `Faltan parámetros requeridos: ${missingParams.join(", ")}`
            });
        }

        const {
            text,
            output_file_name,
            font_size,
            font_color,
            letter_spacing,
            line_height,
            padding,
            shadow_size,
            shadow_opacity,
            stroke_size,
            stroke_color,
            max_width = "850px"
        } = req.body;

        // Iniciar Playwright
        console.log("Iniciando Playwright...");
        browser = await chromium.launch();
        console.log("Playwright iniciado correctamente");

        const context = await browser.newContext();
        const page = await context.newPage();
        console.log("Nueva página creada");
        
        // Configurar el viewport fijo de 1920px de ancho
        await page.setViewportSize({
            width: 1920,
            height: 1080
        });
        console.log("Viewport configurado a 1920x1080");
        
        // Configurar el HTML (mismo HTML que antes...)
        console.log("Configurando contenido HTML...");
        const html = `<!DOCTYPE html>
        <html>
        <head>
            <link href="https://fonts.cdnfonts.com/css/metropolis-2" rel="stylesheet">
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    background: transparent;
                    justify-content: center;
                    align-items: center;
                }
                .text-container {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    font-family: 'Metropolis';
                    font-weight: 900;
                    font-size: ${font_size};
                    color: ${font_color};
                    text-align: center;
                    letter-spacing: ${letter_spacing};
                    line-height: ${line_height};
                    padding: ${padding};
                    text-shadow: ${shadow_size} ${shadow_size} ${shadow_size} rgba(0, 0, 0, ${shadow_opacity});
                    -webkit-text-stroke: ${stroke_size} ${stroke_color};
                    white-space: pre-wrap;
                    overflow: hidden;
                    display: inline-block;
                    max-width: ${max_width};
                }
                .letter { display: inline-block; }
            </style>
        </head>
        <body>
            <div class="text-container" id="text">${text}</div>
        </body>
        </html>`;

        await page.setContent(html);
        console.log("Contenido HTML configurado");

        // Esperar a que la fuente se cargue y el contenido esté listo
        await page.waitForFunction(() => document.fonts.ready);
        console.log("Espera de cargue de fuente completada");

        // Obtener las dimensiones del texto
        const textDimensions = await page.$eval('.text-container', el => {
            const rect = el.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
        });
        console.log("Dimensiones del texto:", textDimensions);

        // Capturar el PNG
        console.log("Capturando PNG...");
        const pngPath = path.join("/tmp", output_file_name);
        
        // Obtener la posición del elemento de texto
        const textBox = await page.$eval('.text-container', el => {
            const rect = el.getBoundingClientRect();
            return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            };
        });
        
        // Capturar solo el área del texto con un pequeño margen
        const margin = 5;
        await page.screenshot({
            path: pngPath,
            omitBackground: true,
            clip: {
                x: textBox.x - margin,
                y: textBox.y - margin,
                width: textBox.width + (margin * 2),
                height: textBox.height + (margin * 2)
            }
        });
        console.log("PNG capturado y guardado en:", pngPath);

        // Subir a GCS
        console.log("Iniciando subida a Google Cloud Storage...");
        await storage.bucket(bucketName).upload(pngPath, {
            destination: output_file_name
        });
        console.log("Archivo subido a GCS");

        // Limpieza
        console.log("Iniciando limpieza de archivos...");
        await browser.close();
        fs.unlinkSync(pngPath);
        console.log("Limpieza completada");

        res.json({
            message: "Success",
            png_url: `https://storage.googleapis.com/${bucketName}/${output_file_name}`
        });
        console.log("Respuesta enviada con éxito");

    } catch (error) {
        console.error("Error en el procesamiento:", error);
        console.error("Stack trace:", error.stack);
        
        // Limpieza en caso de error
        try {
            if (browser) {
                console.log("Cerrando navegador después de error...");
                await browser.close();
                console.log("Navegador cerrado después de error");
            }
        } catch (cleanupError) {
            console.error("Error durante la limpieza:", cleanupError);
        }
        
        res.status(500).json({
            error: "Error en el procesamiento",
            details: error.message
        });
    }
});

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "OK",
        bucket: bucketName,
        storageInitialized: !!storage
    });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
    console.log("Configuración:", {
        bucketName,
        port: PORT,
        nodeEnv: process.env.NODE_ENV,
    });
});