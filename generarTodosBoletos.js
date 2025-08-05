const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const PDFDocument = require('pdfkit');
const { generarBoletoQR } = require('./utils/generarBoleto');

const RUTA_BASE = 'C:\\Users\\5600G\\Documents\\BoletosGraduacion2025';

const pool = mysql.createPool({
    host: '50.62.141.187',
    user: 'adminxona',
    password: 'Cecytem123',
    database: 'CECYTEMXonacatlan',
    waitForConnections: true,
    connectionLimit: 10
});

async function generarPDFBoletos(alumno, invitados) {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({ autoFirstPage: false });
            const nombreLimpio = alumno.nombre_completo.replace(/[<>:"\/\\|?*]+/g, '').trim();
            const pdfPath = path.join(RUTA_BASE, `${nombreLimpio}-Boletos.pdf`);
            const writeStream = fs.createWriteStream(pdfPath);
            doc.pipe(writeStream);

            const nombre = alumno.nombre_completo;
            const curp = alumno.CURP;

            const codigoAlumno = `${curp.slice(-3)}${invitados}${nombre.replace(/\s/g, '').slice(-3).toUpperCase()}CECYT`;
            const imgAlumno = await generarBoletoQR(nombre, 'EGRESADO', codigoAlumno);
            const imgAlumnoData = imgAlumno.replace(/^data:image\/png;base64,/, '');

            doc.addPage({ size: [1536, 700] });
            doc.image(Buffer.from(imgAlumnoData, 'base64'), 0, 0, { width: 1536, height: 700 });

            for (let i = 1; i <= invitados; i++) {
                const codigoInv = `${curp.slice(-3)}${invitados}${nombre.replace(/\s/g, '').slice(-3).toUpperCase()}CECYT-I${i}`;
                const imgInv = await generarBoletoQR(`Invitado ${i}`, 'Invitado', codigoInv);
                const imgInvData = imgInv.replace(/^data:image\/png;base64,/, '');

                doc.addPage({ size: [1536, 700] });
                doc.image(Buffer.from(imgInvData, 'base64'), 0, 0, { width: 1536, height: 700 });
            }

            doc.end();

            writeStream.on('finish', () => {
                console.log(`✅ PDF guardado: ${pdfPath}`);
                resolve();
            });
        } catch (err) {
            console.error('❌ Error generando PDF:', err);
            reject(err);
        }
    });
}

async function generarTodos() {
    try {
        const conn = await pool.getConnection();
        const [alumnos] = await conn.execute(`
      SELECT 
        a.CURP,
        CONCAT(a.PATERNO, ' ', a.MATERNO, ' ', a.NOMBRE) AS nombre_completo,
        SUM(p.MONTO) AS monto_total,
        GREATEST(FLOOR(SUM(p.MONTO) / 80) - 1, 0) AS invitados
      FROM PAGOS p
      JOIN ALUMNOS a ON a.CURP = p.CURP
      WHERE p.CLV_PROCESO_PAGO = 32
      GROUP BY a.CURP, a.PATERNO, a.MATERNO, a.NOMBRE
    `);
        conn.release();

        if (alumnos.length === 0) {
            return console.log('❌ No se encontraron alumnos con pagos.');
        }

        // Crear carpeta base si no existe
        if (!fs.existsSync(RUTA_BASE)) {
            fs.mkdirSync(RUTA_BASE, { recursive: true });
        }

        for (const alumno of alumnos) {
            await generarPDFBoletos(alumno, alumno.invitados);
        }

        console.log('\n🎉 Todos los boletos fueron generados correctamente.');
    } catch (err) {
        console.error('❌ Error general:', err);
    } finally {
        pool.end();
    }
}

generarTodos();
