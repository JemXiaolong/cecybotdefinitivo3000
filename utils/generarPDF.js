const { createCanvas, loadImage } = require('canvas');
const generarQR = require('qrcode');
const path = require('path');

async function generarBoletoQR(nombre, tipo, codigoQR) {
    const width = 1536;
    const height = 700;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Cargar imagen base
    const baseImagePath = path.join(__dirname, 'assets', 'base.png');
    const baseImage = await loadImage(baseImagePath);
    ctx.drawImage(baseImage, 0, 0, width, height);

    // Generar QR con fondo transparente y más nítido
    const qrDataURL = await generarQR.toDataURL(codigoQR, {
        margin: 1,
        scale: 10,
        color: {
            dark: '#000000',
            light: '#00000000'
        }
    });
    const imgQR = await loadImage(qrDataURL);

    const qrSize = 310;
    const qrX = width - qrSize - 150;
    const qrY = (height - qrSize) / 1.5;
    ctx.drawImage(imgQR, qrX, qrY, qrSize, qrSize);

    // EGRESADO / INVITADO
    ctx.fillStyle = '#000000ff';
    ctx.font = 'bold 100px "Georgia"';
    ctx.fillText(tipo, 220, 330);

    // NOMBRE
    ctx.fillStyle = '#bba138ff';
    ctx.font = 'bold 36px "Georgia"';
    ctx.textAlign = 'left';
    ctx.fillText(nombre.toUpperCase(), 200, 395);

    // Información del evento
    ctx.fillStyle = '#000000ff';
    ctx.font = '40px "Garamond"';
    ctx.fillText('25 DE JULIO DE 2025', 260, 490);

    // Selección de hora según el tipo
    const horaEvento = tipo.toLowerCase() === 'egresado' ? '10:00 HRS' : '10:30 HRS';
    ctx.fillText(horaEvento, 700, 490);

    // Código único
    ctx.font = '20px "Garamond"';
    ctx.fillStyle = '#7f8c8d';
    ctx.fillText(`Folio: ${codigoQR}`, 1100, 590);

    return canvas.toDataURL();
}

module.exports = { generarBoletoQR };
