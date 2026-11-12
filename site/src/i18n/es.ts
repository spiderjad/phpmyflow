import type { Messages } from './types';

// Español neutro, con "tú". El texto entre comillas invertidas se muestra como código.
export const es: Messages = {
  meta: {
    title: 'phpMyFlow · El reemplazo moderno de phpMyAdmin',
    description:
      'Administrador web de código abierto para MySQL y MariaDB que se instala como phpMyAdmin: una carpeta de PHP, sin recargas, un editor SQL que detecta errores y un asistente opcional que conoce tu esquema.',
    ogImageAlt: 'phpMyFlow: el reemplazo moderno de phpMyAdmin, con su tabla de datos',
  },
  a11y: {
    skip: 'Saltar al contenido',
    mainNav: 'Principal',
    mobileNav: 'Principal (móvil)',
    menu: 'Menú',
    language: 'Idioma',
    external: '(abre GitHub)',
  },
  nav: { features: 'Funciones', screenshots: 'Capturas', compare: 'Comparativa', install: 'Instalación', faq: 'Preguntas' },
  hero: {
    eyebrow: 'Código abierto · MySQL y MariaDB',
    title: 'El reemplazo moderno de phpMyAdmin',
    subtitle: 'Sube una carpeta de PHP, entra con tu usuario de MySQL y trabaja sin recargas.',
    download: 'Descargar',
    demo: 'Probar la demo',
    demoSoon: 'Demo · próximamente',
    github: 'GitHub',
    status: 'En desarrollo (v0.1): pruébalo primero con datos de prueba.',
    shotAlt:
      'phpMyFlow con la tabla orders de la base de ejemplo: nombres de clientes junto a sus ids y el detalle del pedido 2 con sus filas relacionadas.',
  },
  features: {
    eyebrow: 'Funciones',
    title: 'Todo lo que haces en phpMyAdmin, con menos fricción',
    intro: 'Pensado para el trabajo de cada día: mirar tablas, corregir una fila, escribir una consulta, mover una base.',
    items: [
      {
        icon: 'bolt',
        title: 'Sin recargas',
        text: 'Recorre tablas, ordena, filtra y edita celdas al instante. La tabla sigue rápida con miles de filas.',
      },
      {
        icon: 'spark-check',
        title: 'Un editor SQL que detecta errores',
        text: 'Los nombres de tabla o columna mal escritos se subrayan mientras escribes, con un arreglo en un clic: "¿Quisiste decir `customers`?"',
      },
      {
        icon: 'assistant',
        title: 'Un asistente que conoce tu esquema',
        text: 'Describe lo que necesitas y obtén la consulta. Explica, corrige y optimiza, y nunca ejecuta nada por su cuenta.',
      },
      {
        icon: 'link',
        title: 'Nombres en lugar de ids',
        text: 'Las columnas relacionadas muestran "Planta Norte · 1", aunque no haya claves foráneas declaradas, y se editan con un buscador de registros.',
      },
      {
        icon: 'transfer',
        title: 'Exportar e importar seguros',
        text: 'Las bases grandes se mueven en pasos cortos con progreso real. Si se corta la conexión, sigue donde quedó.',
      },
      {
        icon: 'shield',
        title: 'Seguro por defecto',
        text: 'Las conexiones de producción confirman cada escritura, las columnas de contraseñas quedan ocultas, CSRF en cada cambio y modo de solo lectura.',
      },
    ],
  },
  gallery: {
    eyebrow: 'Capturas',
    title: 'Míralo funcionando',
    intro: 'Todas las capturas usan la base de ejemplo que trae el proyecto. Siguen tu modo claro u oscuro.',
    items: [
      {
        id: 'grid',
        title: 'Tabla de datos',
        text: 'Las filas relacionadas por su nombre, editadas con un buscador de registros.',
        alt: 'La tabla departamentos: la columna de planta dice "Planta Norte · 1" y un buscador lista las plantas por nombre.',
      },
      {
        id: 'sql',
        title: 'Editor SQL',
        text: 'Una tabla mal escrita se subraya con un arreglo antes de ejecutar nada.',
        alt: 'El editor SQL subraya "custmers" y sugiere "customers".',
      },
      {
        id: 'structure',
        title: 'Editor de estructura',
        text: 'Cambia columnas e índices y revisa el único ALTER que se va a ejecutar.',
        alt: 'La estructura de la tabla products con tipos de columna, claves y valores por defecto.',
      },
      {
        id: 'relations',
        title: 'Relaciones',
        text: 'Las relaciones declaradas e inferidas de cada tabla, en un diagrama con el número de filas.',
        alt: 'Relaciones de la tabla orders: apunta a customers; order_items (declarada) y order_notes (inferida) apuntan a ella.',
      },
      {
        id: 'export',
        title: 'Exportar',
        text: 'SQL, CSV, JSON o Excel, en pasos que funcionan en cualquier hosting compartido.',
        alt: 'El diálogo de exportación con el formato, las tablas y las opciones.',
      },
      {
        id: 'monitor',
        title: 'Monitor',
        text: 'Contadores en vivo, procesos en curso y las consultas más pesadas.',
        alt: 'La pestaña Monitor con gráficos en vivo de consultas y conexiones.',
      },
    ],
  },
  compare: {
    eyebrow: 'Comparativa',
    title: 'phpMyFlow, phpMyAdmin y Adminer',
    intro:
      'phpMyAdmin y Adminer son herramientas maduras y probadas. Esta es una comparación honesta, incluido lo que phpMyFlow todavía no hace.',
    caption: 'Comparación de funciones entre phpMyFlow, phpMyAdmin y Adminer',
    feature: 'Función',
    marks: { yes: 'Sí', partial: 'En parte', no: 'No' },
    rows: [
      {
        label: 'Aplicación de una sola página (sin recargas)',
        cells: [{ mark: 'yes' }, { mark: 'partial', note: 'Algunas acciones' }, { mark: 'no' }],
      },
      {
        label: 'Tablas y columnas desconocidas marcadas mientras escribes',
        cells: [{ mark: 'yes', note: 'Con "¿quisiste decir?"' }, { mark: 'partial', note: 'Revisión de sintaxis' }, { mark: 'no' }],
      },
      {
        label: 'Asistente que escribe SQL a partir de tu esquema',
        cells: [{ mark: 'yes', note: 'Opcional' }, { mark: 'no' }, { mark: 'partial', note: 'Plugin' }],
      },
      {
        label: 'Nombres en lugar de ids en columnas relacionadas',
        cells: [
          { mark: 'yes', note: 'También relaciones inferidas' },
          { mark: 'partial', note: 'Requiere el almacenamiento de configuración' },
          { mark: 'no' },
        ],
      },
      {
        label: 'Exportar e importar que siguen tras un corte',
        cells: [{ mark: 'yes' }, { mark: 'partial', note: 'Solo importar' }, { mark: 'no' }],
      },
      {
        label: 'Avisos de producción y columnas de contraseñas ocultas',
        cells: [{ mark: 'yes' }, { mark: 'no' }, { mark: 'no' }],
      },
      { label: 'Monitor del servidor', cells: [{ mark: 'yes' }, { mark: 'yes' }, { mark: 'no' }] },
      {
        label: 'Gestión de usuarios y privilegios',
        cells: [{ mark: 'no', note: 'Muestra tus permisos' }, { mark: 'yes' }, { mark: 'yes' }],
      },
      {
        label: 'Inicio de sesión en dos pasos',
        cells: [{ mark: 'no', note: 'Previsto' }, { mark: 'yes' }, { mark: 'partial', note: 'Plugin' }],
      },
      {
        label: 'Motores de base de datos',
        cells: [{ text: 'MySQL, MariaDB' }, { text: 'MySQL, MariaDB' }, { text: 'MySQL, MariaDB, PostgreSQL, SQLite y más' }],
      },
      {
        label: 'Instalación',
        cells: [{ text: 'Subir una carpeta' }, { text: 'Subir una carpeta' }, { text: 'Subir un archivo PHP' }],
      },
      { label: 'Idiomas de la interfaz', cells: [{ text: '4' }, { text: '98' }, { text: '47' }] },
      { label: 'Madurez', cells: [{ text: 'Nuevo (v0.1)' }, { text: 'Desde 1998' }, { text: 'Desde 2007' }] },
    ],
    footnote:
      'Comparado con phpMyAdmin 5.2 y Adminer 6.3 (noviembre de 2026), sin plugins adicionales salvo donde se indica. ¿Algo está mal? Abre un issue en GitHub.',
  },
  install: {
    eyebrow: 'Instalación',
    title: 'Funcionando en cinco minutos',
    intro: 'Requisitos: PHP 8.1 o posterior con `pdo_mysql` y `openssl` (recomendado 8.3+: las versiones anteriores ya no reciben parches de seguridad). Sin Composer, sin Node en el servidor y sin reescritura de URL.',
    tablist: 'Formas de instalar',
    tabs: [
      {
        id: 'hosting',
        label: 'Hosting PHP',
        intro: 'Igual que instalas phpMyAdmin: subiendo una carpeta.',
        steps: [
          { text: 'Descarga `phpmyflow-x.y.z.zip` de la última versión y descomprímelo.' },
          { text: 'Sube la carpeta a tu sitio, por ejemplo a `public_html/phpmyflow/`.' },
          {
            text: 'Copia `config.sample.php` como `config.php` y pon tus servidores de base de datos.',
            code: 'cp config.sample.php config.php',
            codeLabel: 'Comando',
          },
          { text: 'Abre `https://tu-sitio/phpmyflow/` y entra con un usuario de MySQL.' },
        ],
        note: 'Si puedes, restringe el acceso a la carpeta (lista de IP, VPN o autenticación HTTP) y sírvela siempre por HTTPS.',
      },
      {
        id: 'docker',
        label: 'Docker',
        intro: 'Arranca MariaDB con una base de ejemplo `shop` junto a phpMyFlow.',
        steps: [
          {
            text: 'Clona el repositorio y arráncalo.',
            code: 'git clone https://github.com/spiderjad/phpmyflow.git\ncd phpmyflow\ndocker compose up --build',
            codeLabel: 'Comandos',
          },
          { text: 'Abre `http://localhost:8080` y entra con el usuario `root` y la contraseña `root`.' },
        ],
      },
      {
        id: 'lan',
        label: 'Red local',
        intro: 'Sírvelo a tu equipo desde tu propio ordenador con el servidor integrado de PHP.',
        steps: [
          {
            text: 'Clona el repositorio.',
            code: 'git clone https://github.com/spiderjad/phpmyflow.git\ncd phpmyflow',
            codeLabel: 'Comandos',
          },
          {
            text: 'Windows (PowerShell):',
            code: '.\\scripts\\serve-lan.ps1',
            codeLabel: 'Windows (PowerShell)',
          },
          { text: 'macOS o Linux:', code: './scripts/serve-lan.sh', codeLabel: 'macOS o Linux' },
          {
            text: 'El script comprueba PHP, compila la interfaz la primera vez (necesita Node.js una sola vez) y muestra la dirección para los demás ordenadores.',
          },
        ],
        note: 'El servidor integrado de PHP no tiene HTTPS: úsalo solo en redes de confianza.',
      },
    ],
    copy: 'Copiar',
    copied: 'Copiado',
  },
  ai: {
    eyebrow: 'IA y privacidad',
    title: 'El asistente ve tu esquema, nunca tus filas',
    intro: 'El asistente es opcional y viene apagado. Si lo activas, esto es exactamente lo que pasa.',
    points: [
      {
        title: 'Solo se envía la estructura',
        text: 'Nombres de tablas y columnas, tipos, claves y planes de ejecución (`EXPLAIN`). Los datos de las filas nunca salen de tu servidor.',
      },
      {
        title: 'La clave queda en el servidor',
        text: 'La clave de la API vive en `config.php`. El navegador nunca la recibe.',
      },
      {
        title: 'Nunca ejecuta SQL',
        text: 'La consulta llega al editor. Tú la lees y decides si ejecutarla.',
      },
      {
        title: 'Todo en local con Ollama',
        text: 'Funciona con Anthropic, APIs compatibles con OpenAI, OpenRouter o un modelo local con Ollama, y entonces nada sale de tu red.',
      },
    ],
  },
  security: {
    eyebrow: 'Seguridad',
    title: 'El acceso directo a bases de datos merece cuidado',
    intro: 'phpMyFlow está hecho para que lo seguro sea lo normal.',
    points: [
      'Cada cambio es una petición POST con un token CSRF.',
      'Una sentencia por petición; los nombres de tablas y columnas se comprueban en el servidor antes de usarlos, y los valores siempre van en sentencias preparadas.',
      'Confirmación antes de `DROP`, `TRUNCATE`, o `UPDATE` y `DELETE` sin `WHERE`.',
      'Límite de intentos de acceso, lista de servidores permitidos y modo opcional de solo lectura.',
      'Las conexiones marcadas como producción confirman cada escritura; las columnas de contraseñas quedan ocultas hasta que las muestras.',
    ],
    reportTitle: '¿Encontraste una vulnerabilidad?',
    report:
      'Por favor, no abras un issue público. Avísanos en privado por GitHub o por correo; te respondemos en menos de 72 horas.',
    policy: 'Lee la política de seguridad',
    email: 'Correo',
  },
  faq: {
    eyebrow: 'Preguntas',
    title: 'Preguntas frecuentes',
    items: [
      {
        q: '¿Es gratis?',
        a: 'Sí. phpMyFlow es de código abierto con licencia GNU AGPL-3.0: puedes usarlo, estudiarlo y modificarlo gratis. Si ofreces a otras personas una copia modificada, compartes también su código.',
      },
      {
        q: '¿Funciona en mi hosting?',
        a: 'Si ahí funciona phpMyAdmin, funciona phpMyFlow: solo necesita PHP 8.1 o posterior con `pdo_mysql` y `openssl`. Sin Composer, sin Node y sin reescritura de URL en el servidor.',
      },
      {
        q: '¿Es compatible con PostgreSQL?',
        a: 'Todavía no. Hoy funciona con MySQL y MariaDB. Un controlador para PostgreSQL está en la hoja de ruta.',
      },
      {
        q: '¿Qué requisitos tiene?',
        a: 'Un servidor web con PHP 8.1+ (`pdo_mysql` y `openssl`; mejor 8.3 o posterior, que sigue recibiendo parches de seguridad), un servidor MySQL o MariaDB y un navegador reciente. Node.js solo hace falta para compilar desde el código.',
      },
      {
        q: '¿Mis datos van a la IA?',
        a: 'No. El asistente viene apagado. Cuando está activo envía el esquema y los planes de ejecución, nunca filas, y con Ollama nada sale de tu equipo.',
      },
      {
        q: '¿Está listo para producción?',
        a: 'Todavía no. phpMyFlow está en desarrollo (v0.1). Pruébalo primero con datos de prueba o con un usuario de solo lectura, y sigue las versiones en GitHub.',
      },
    ],
  },
  footer: {
    tagline: 'El reemplazo moderno de phpMyAdmin para MySQL y MariaDB.',
    product: 'Producto',
    project: 'Proyecto',
    contact: 'Contacto',
    releases: 'Versiones',
    security: 'Política de seguridad',
    madeBy: 'Hecho por',
    license: 'Licencia',
    licenseTbd: 'Licencia: por definir',
  },
  notFound: {
    title: 'Página no encontrada',
    text: 'Esta página no existe o se movió.',
    back: 'Volver al inicio',
  },
};
