# NeoCode

NeoCode es una interfaz gráfica para trabajar con agentes sobre proyectos. Deriva de [T3 Code](https://github.com/pingdotgg/t3code) y puede usar NeoPi como motor: vos planteás el objetivo, revisás la evidencia y decidís qué acciones autorizar. El agente ayuda a investigar y construir; no reemplaza el conocimiento del negocio ni la revisión humana.

## Primeros pasos

1. Conseguí una versión apropiada en [publicaciones de NeoCode de Cooperbit](https://github.com/CooperbitQuarxs/neocode/releases) y revisá sus archivos y plataforma. Una publicación o archivo disponible no demuestra que se haya probado la instalación en tu equipo; las versiones preliminares pueden cambiar.
2. Configurá acceso autorizado a un proveedor de modelos. Las cuentas y el acceso de oficina todavía requieren configuración; no asumas que ya están habilitados. Elegí el proveedor NeoPi y un proyecto al que tengas acceso.
3. Empezá con algo verificable y sin modificaciones: «Explicá dónde se valida el ingreso de clientes, citá los archivos y señalá lo que no puedas comprobar». Contrastá la respuesta, pedí aclaraciones y solo después autorizá un cambio acotado y su comprobación. No compartas secretos ni información sensible sin autorización.

NeoCode ejecuta el proveedor NeoPi como proceso en el entorno donde corre su servidor, sin necesitar NeoCore. En la búsqueda predeterminada prueba `npi` del entorno antes de un `npi` incluido en recursos de escritorio, y después `omp`; también se puede configurar una ruta explícita. El empaquetado **puede** incluir `npi` en Linux si se suministra al construirlo: no todos los paquetes ni plataformas lo incluyen necesariamente. Si tu paquete no lo trae, necesitás un ejecutable compatible accesible al entorno o una ruta configurada. Consultá [la guía de NeoCode](./docs/user/neocode-inicio.md) para el detalle y los límites.

## Hoy y hacia dónde

Hoy NeoCode puede usar una instancia local de NeoPi; NeoPi también funciona por sí solo desde la terminal. NeoCore, un daemon sin interfaz basado en código del motor de NeoPi, **todavía no está implementado**. La dirección propuesta es que NeoCode y NeoPi puedan conectarse a agentes alojados por la aplicación, en un daemon local o en uno remoto; NeoCode adaptaría sus entornos para seleccionar el destino. NeoPi conservaría su motor y ejecución local. No confundas esta dirección futura con una función NeoCore disponible hoy.

El [panorama general](https://github.com/CooperbitQuarxs/neopi/blob/neopi/docs/panorama-general.md) explica modelos, agentes, permisos, primera tarea y los demás componentes. NeoProxy y NeoDeck forman parte de la propuesta de servicios de oficina; su configuración y conexión no se presuponen realizadas.

## Repositorio y licencia

Este repositorio privado es el espejo para Cooperbit. El desarrollo activo está en [PsychedelicShayna/neocode](https://github.com/PsychedelicShayna/neocode), con sus [pull requests](https://github.com/PsychedelicShayna/neocode/pulls?q=is%3Apr) e [issues](https://github.com/PsychedelicShayna/neocode/issues?q=is%3Aissue). La presencia de código o releases en el espejo no garantiza que cada versión esté aprobada para el equipo. La documentación heredada está en [docs](./docs/README.md).

El código está bajo licencia **MIT** (ver [LICENSE](./LICENSE)); se conservan los avisos de copyright del código heredado y del proyecto.
