const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const mysql = require('mysql2/promise');
const PDFDocument = require('pdfkit');
const { generarBoletoQR } = require('./utils/generarBoleto');
const streamBuffers = require('stream-buffers');
const axios = require('axios');

const pool = mysql.createPool({
    host: '50.62.141.187',
    user: 'adminxona',
    password: 'Cecytem123',
    database: 'CECYTEMXonacatlan',
    waitForConnections: true,
    connectionLimit: 10
});

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Ajusta la ruta si tienes Chrome en otro lugar
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('🤖 Bot conectado a WhatsApp'));

let usuarios = {};

async function consultarIA(prompt) {
    try {
        const res = await axios.post('http://localhost:11434/api/generate', {
            model: 'gemma3',
            prompt: prompt,
            stream: false
        });
        return res.data.response.trim();
    } catch (error) {
        console.error('Error al consultar IA:', error);
        return '❌ No se pudo contactar con la IA.';
    }
}

async function generarPDFBoletos(alumno, invitados) {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({ autoFirstPage: false });
            const bufferStream = new streamBuffers.WritableStreamBuffer();
            doc.pipe(bufferStream);

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

            bufferStream.on('finish', () => {
                const pdfBuffer = bufferStream.getContents();
                resolve(pdfBuffer);
            });
        } catch (err) {
            reject(err);
        }
    });
}

client.on('message', async msg => {
    const chatId = msg.from;
    const texto = msg.body.trim();

    // Solo responder mensajes directos (no grupos)
    if (chatId.includes('@g.us')) return;

    if (texto.toLowerCase() === 'salir' || texto === '4') {
        delete usuarios[chatId];
        return msg.reply('👋 Sesión cerrada. Escribe "cecybot" para comenzar de nuevo.');
    }


    //ACTIVACIÓN CON PALABRA CLAVE
    /*if (!usuarios[chatId]) {
        if (texto.toLowerCase() !== 'cecybot') return;
        usuarios[chatId] = { estado: 'esperando_curp' };
        return msg.reply(
            '👋 ¡Bienvenido Leopardo! Soy *Cecywhats 🤖🐯*\n\n' +
            '📄 Por favor, envíame tu CURP (18 caracteres).\n\n*Solo estudiantes del plantel CECyTEM Xonacatlán.*\n\n' +
            'Si no estás registrado, accede a la ventanilla electrónica y llena el formulario:\nhttps://forms.gle/VCFrtqVo3sQU4rFo6'
        );
    }*/


    if (!usuarios[chatId]) {
        // Cualquier mensaje inicial activa el bot
        usuarios[chatId] = { estado: 'esperando_curp' };
        return msg.reply(
            '👋 ¡Bienvenido Leopardo! Soy *Cecywhats 🤖🐯*\n\n' +
            '📄 Por favor, envíame tu CURP (18 caracteres).\n\n*Solo estudiantes del plantel CECyTEM Xonacatlán.*\n\n' +
            'Si no estás registrado, accede a la ventanilla electrónica y llena el formulario:\nhttps://forms.gle/VCFrtqVo3sQU4rFo6'
        );
    }

    const estado = usuarios[chatId].estado;

    if (estado === 'esperando_curp') {
        if (texto.length !== 18) return msg.reply('⚠️ La CURP debe tener exactamente 18 caracteres. Intenta de nuevo:');
        usuarios[chatId].curp = texto.toUpperCase();
        usuarios[chatId].estado = 'esperando_control';
        return msg.reply('✅ CURP recibida. Ahora, envíame tu número de control:');
    }

    if (estado === 'esperando_control') {
        usuarios[chatId].nocontrol = texto;

        try {
            const conn = await pool.getConnection();
            const [rows] = await conn.execute(`
                SELECT ALUMNOS.NO_CONTROL AS NOCONT, ALUMNOS.CURP AS _CURP, PATERNO, MATERNO, NOMBRE,
                       GRUPOS.GRUPO, GRUPOS.TURNO, GRUPOS.LINK AS LINKGRUPO, DETALLE_GRUPOS.LINK AS LINKALUMNO,
                       OBSERVACIONES_ALUMNOS.CONCEPTO AS CONCEPT, ADEUDOS.CONCEPTO AS ADEUDO_CONCEPTO, VALOR,
                       NOTAS, CARRERA
                FROM ((ALUMNOS
                LEFT JOIN ADEUDOS ON ADEUDOS.CURP = ALUMNOS.CURP)
                LEFT JOIN OBSERVACIONES_ALUMNOS ON ALUMNOS.NO_CONTROL = OBSERVACIONES_ALUMNOS.NO_CONTROL)
                LEFT JOIN (DETALLE_GRUPOS INNER JOIN GRUPOS ON DETALLE_GRUPOS.CLV_GRUPO = GRUPOS.CLV_GRUPO)
                ON DETALLE_GRUPOS.NO_CONTROL = ALUMNOS.NO_CONTROL
                WHERE ALUMNOS.NO_CONTROL = ? AND ALUMNOS.CURP = ?
                LIMIT 1
            `, [usuarios[chatId].nocontrol, usuarios[chatId].curp]);
            conn.release();

            if (rows.length === 0) {
                delete usuarios[chatId];
                return msg.reply('❌ No se encontró ningún estudiante con esos datos.\n\n🔁 Escribe "cecybot" para volver a comenzar.');
            }

            usuarios[chatId].datos = rows[0];
            usuarios[chatId].estado = 'activo';

            return msg.reply(`🎓 Hola *${rows[0].NOMBRE} ${rows[0].PATERNO} ${rows[0].MATERNO}*, ya estoy listo para ayudarte.\n\nPuedes hacerme preguntas directamente, por ejemplo:\n- ¿Tengo adeudos?\n- Quiero mis boletos\n- ¿Dónde está mi formato de pago?\n\nEscribe "salir" para cerrar sesión.`);
        } catch (err) {
            console.error('❌ Error MySQL:', err);
            delete usuarios[chatId];
            return msg.reply('❌ Error interno. Escribe "cecybot" para volver a intentarlo.');
        }
    }

    if (estado === 'activo') {
        const d = usuarios[chatId].datos;
        const pregunta = texto.toLowerCase();

        const permiteAdeudos = pregunta.includes('adeudo');
        const permiteBoletos = pregunta.includes('boleto');
        const permiteFormato = pregunta.includes('formato');

        if (!permiteAdeudos && !permiteBoletos && !permiteFormato) {
            return msg.reply('🔒 Muy pronto podrás realizar más consultas pequeño leopardo 🐆');
        }

        const prompt = `Actúa como un asistente escolar para un alumno con estos datos:
- Nombre: ${d.NOMBRE} ${d.PATERNO} ${d.MATERNO}
- CURP: ${d._CURP}
- No. Control: ${d.NOCONT}
- Carrera: ${d.CARRERA}
- Grupo: ${d.GRUPO || 'No disponible'}
- Adeudo: ${d.ADEUDO_CONCEPTO || 'ninguno'}
- Formato de pago: ${d.LINKALUMNO || 'no disponible'}

El alumno pregunta: "${texto}"

Si el alumno pide "boletos" o "boleto" o algo similar, responde solo con la palabra "GENERAR_BOLETOS".
Si pide adeudos o formato, responde de manera corta y directa.
Si pregunta otra cosa, responde solo: "Muy pronto podrás realizar más consultas pequeño leopardo 🐆".`;

        const respuestaIA = await consultarIA(prompt);

        if (respuestaIA.includes('GENERAR_BOLETOS')) {
            await msg.reply('⏳ Enseguida te entrego tus boletos...');

            try {
                const conn = await pool.getConnection();
                const [rows] = await conn.execute(`
                    SELECT 
                        a.CURP,
                        CONCAT(a.PATERNO, ' ', a.MATERNO, ' ', a.NOMBRE) AS nombre_completo,
                        SUM(p.MONTO) AS monto_total,
                        GREATEST(FLOOR(SUM(p.MONTO) / 80) - 1, 0) AS invitados
                    FROM PAGOS p
                    JOIN ALUMNOS a ON a.CURP = p.CURP
                    WHERE p.CLV_PROCESO_PAGO = 32 AND a.CURP = ?
                    GROUP BY a.CURP, a.PATERNO, a.MATERNO, a.NOMBRE
                `, [d._CURP]);
                conn.release();

                if (rows.length === 0) return msg.reply('❌ No tienes boletos disponibles.');

                const alumno = rows[0];
                const nombre = alumno.nombre_completo;
                const curp = alumno.CURP;
                const invitados = alumno.invitados;

                const codigoAlumno = `${curp.slice(-3)}${invitados}${nombre.replace(/\s/g, '').slice(-3).toUpperCase()}CECYT`;
                const boletoAlumno = await generarBoletoQR(nombre, 'EGRESADO', codigoAlumno);
                await client.sendMessage(chatId, new MessageMedia('image/png', boletoAlumno.split(',')[1]));

                for (let i = 1; i <= invitados; i++) {
                    const codigoInv = `${curp.slice(-3)}${invitados}${nombre.replace(/\s/g, '').slice(-3).toUpperCase()}CECYT-I${i}`;
                    const boletoInv = await generarBoletoQR(`Invitado ${i}`, 'Invitado', codigoInv);
                    await client.sendMessage(chatId, new MessageMedia('image/png', boletoInv.split(',')[1]));
                }

                await msg.reply('🖨️ *También te compartimos los boletos en PDF para que puedas imprimirlos.*\n\n🎫 Tu boleto lo puedes presentar impreso o directamente en tu celular para escanear. \n\n *⚠️ IMPORTANTE:* Cada Boleto es único e irrepetible, debe presentarse durante el acceso al evento');

                const pdfBuffer = await generarPDFBoletos(alumno, invitados);
                await client.sendMessage(chatId, new MessageMedia('application/pdf', pdfBuffer.toString('base64'), 'boletos.pdf'));

                return msg.reply('✅ Boletos generados correctamente. Puedes seguir preguntando o escribe "salir" para cerrar sesión.');
            } catch (err) {
                console.error('❌ Error al generar boletos:', err);
                return msg.reply('❌ Hubo un error al generar tus boletos.');
            }
        } else {
            await msg.reply('⏳ Enseguida te doy el dato...');
            return msg.reply(respuestaIA);
        }
    }
});

client.initialize();
