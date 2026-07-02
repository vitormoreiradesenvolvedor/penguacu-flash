<div align="center">

<img src="build/icon.png" width="120" alt="Penguaçu-Flash" />

# Penguaçu-Flash

### Crea memorias USB de arranque de Windows 7 · 8.1 · 10 · 11, desde Linux — de forma fácil

Un AppImage totalmente autónomo que formatea tu USB, copia Windows e inyecta un `autounattend.xml` personalizado — para que la instalación se ejecute sin intervención, con tu cuenta, idioma y ajustes de privacidad ya configurados.

**🌍 Léelo en:** [English](README.md) · [Português](README.pt-BR.md) · **Español** · [中文](README.zh.md) · [हिन्दी](README.hi.md) · [العربية](README.ar.md)

<br/>

![Plataforma](https://img.shields.io/badge/plataforma-Linux-1B2A6B?style=for-the-badge&logo=linux&logoColor=white)
![AppImage](https://img.shields.io/badge/paquete-AppImage-3A55D8?style=for-the-badge)
![Licencia](https://img.shields.io/badge/licencia-MIT-059669?style=for-the-badge)
![PRs bienvenidos](https://img.shields.io/badge/PRs-bienvenidos-FF9E1B?style=for-the-badge)

</div>

---

## ✨ ¿Por qué Penguaçu-Flash?

Hacer una USB de instalación de Windows en Linux suele implicar lidiar a mano con `parted`, `mkntfs`, `7z` y herramientas de sector de arranque — y aun así Windows se detiene a mitad de la instalación haciendo preguntas. Penguaçu-Flash lo hace todo en una sola ventana:

- 🐧 **Funciona en cualquier lugar** — un AppImage autónomo. Sin dependencias que instalar: `7-Zip`, `mkntfs` y `ms-sys` vienen incluidos.
- 💾 **USB de arranque real** — particiona, formatea NTFS, copia Windows y escribe los sectores de arranque para **UEFI y BIOS/legado**.
- 🪄 **Verdaderamente desatendido** — inyecta un `autounattend.xml` personalizado para que la instalación pase de largo las preguntas, con usuario, contraseña, nombre del equipo, zona horaria y edición ya rellenados.
- 🧭 **Windows 7 → 11, detección automática** — la versión se reconoce por el nombre del archivo ISO, y el archivo de respuesta se adapta al esquema de cada versión.
- 🛡️ **Windows 11 sin los bloqueos** — omisión opcional de los requisitos de TPM 2.0, Secure Boot, RAM y CPU.
- 🔒 **Privacidad de fábrica** — desactiva telemetría, Cortana, BitLocker automático, apps patrocinadas y más.
- 📊 **Progreso honesto** — la barra sigue los bytes *escritos físicamente en el dispositivo* (con MB/s en vivo), no el engañoso número de la caché de RAM.
- 🌐 **Habla 6 idiomas** — portugués, inglés, español, chino, hindi y árabe (con diseño de derecha a izquierda completo).

---

## 📸 Capturas de pantalla

> _Añade tus capturas a `docs/` y enlázalas aquí._
>
> `docs/screenshot-wizard.png` · `docs/screenshot-usb.png`

---

## 🚀 Descargar y ejecutar

1. Descarga el **`Penguaçu-Flash-*.AppImage`** más reciente desde la página de [**Releases**](../../releases).
2. Hazlo ejecutable y ejecútalo:

```bash
chmod +x Penguaçu-Flash-*.AppImage
./Penguaçu-Flash-*.AppImage
```

Eso es todo — sin instalación, sin dependencias. Los pasos con privilegios (particionar, formatear, escribir sectores de arranque) piden tu contraseña una vez mediante el diálogo de autorización estándar del sistema.

> **Consejo:** en KDE/GNOME también puedes hacer doble clic en el AppImage desde tu gestor de archivos.

---

## 🧭 Cómo usar

| Paso | Qué ocurre |
|------|------------|
| **1. ISO** | Suelta tu ISO de Windows. La versión (7/8.1/10/11) se detecta automáticamente. |
| **2. Identidad** | Define usuario, contraseña, nombre del equipo, zona horaria, edición y (opcional) clave de producto. |
| **3. Ajustes** | Elige los ajustes de privacidad/comportamiento y, para Windows 11, la omisión de requisitos. |
| **4. Crear** | Elige **Generar ISO** (un nuevo `.iso` personalizado) o **Crear USB** (formatea + copia + inyecta una USB lista para arrancar). |
| **5. Listo** | Arranca la máquina de destino desde la USB — Windows se instala con tu configuración. |

También puedes **analizar una USB existente**, leer su `autounattend.xml` y reinyectar una configuración actualizada sin reconstruir nada.

---

## 🛠️ Compilar desde el código fuente

Requisitos: **Node.js 18+**, y en la máquina de compilación `ntfsprogs` (para `mkntfs`) más `gcc`/`make` (para compilar el `ms-sys` incluido).

```bash
git clone https://github.com/vitormoreiradesenvolvedor/penguacu-flash.git
cd penguacu-flash
npm install

# Descarga/compila los binarios incluidos (7-Zip, mkntfs, ms-sys) en ./bin
npm run prepare-bins

# Genera dist/Penguaçu-Flash-<versión>.AppImage
npm run dist
```

Para ejecutarlo durante el desarrollo:

```bash
npm start
```

### Estructura del proyecto

```
├── main.js              # Proceso principal de Electron — lógica de USB/ISO, IPC
├── preload.js           # API expuesta al renderer vía contextBridge
├── index.html           # Toda la interfaz (asistente, diccionario i18n, estilos)
├── scripts/
│   ├── prepare-bins.sh  # Descarga/compila los binarios incluidos
│   └── afterPack.js     # Envuelve el binario de Electron (entorno + filtro de ruido)
└── build/
    ├── icon.svg         # Icono fuente
    └── icons/           # Tamaños PNG renderizados
```

---

## 🤝 Contribuir

¡Las contribuciones son muy bienvenidas! Este proyecto existe para ayudar a la comunidad Linux, y mejora con más manos. 🐧

- 🌐 **Traducciones**: el diccionario de la interfaz está en `index.html` (objeto `I18N`). Añadir o mejorar un idioma es un gran primer PR.
- 🐛 **Errores e ideas**: abre un [issue](../../issues) con pasos claros para reproducir.
- 🔧 **Código**: haz fork, crea una rama desde **`development`** y abre un pull request contra ella.

Consulta [CONTRIBUTING.md](CONTRIBUTING.md) para la guía completa. Modelo de ramas:

- **`master`** — código estable, publicado.
- **`development`** — donde entra el trabajo nuevo antes del siguiente lanzamiento.

---

## ⚠️ Aviso

Crear una USB de arranque **borra todos los datos** del disco seleccionado. Comprueba dos veces que elegiste el dispositivo correcto. Las claves de producto mostradas en la app son las claves genéricas/KMS públicas de Microsoft — seleccionan la edición durante la instalación, pero **no activan** Windows. Actívalo con una licencia válida.

---

## 📄 Licencia

Publicado bajo la [Licencia MIT](LICENSE) — libre para usar, modificar y compartir.

<div align="center">
<br/>
Hecho con 🐧 para la comunidad Linux.
</div>
