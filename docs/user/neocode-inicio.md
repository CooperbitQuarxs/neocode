# Empezar con NeoCode y NeoPi

NeoCode ofrece una interfaz gráfica para conversar con agentes y trabajar sobre proyectos. NeoPi aporta un motor de agentes y también tiene su propia interfaz de terminal. Para los fundamentos y un ejercicio compartido, consultá el [panorama general](https://github.com/CooperbitQuarxs/neopi/blob/neopi/docs/panorama-general.md).

## Preparar el entorno

Buscá un paquete compatible en las [publicaciones de Cooperbit](https://github.com/CooperbitQuarxs/neocode/releases), revisando versión, plataforma y archivos disponibles. Los releases preliminares pueden cambiar. Un archivo publicado no prueba la instalación en tu equipo; esta guía no certifica ninguna instalación. También precisás acceso autorizado y configurado a un proveedor de modelos. Las cuentas y el acceso de oficina todavía deben configurarse.

En el código actual, NeoCode inicia un ejecutable NeoPi como proceso del entorno de su servidor y se comunica con él mediante RPC. Con la configuración predeterminada busca primero `npi` en el entorno, luego el `bin/npi` incluido en recursos de escritorio si existe y finalmente `omp`. Una ruta de ejecutable configurada explícitamente se usa en lugar de esa búsqueda. Si el ejecutable elegido falla al comprobar su versión, no se debe asumir que pasará silenciosamente a otro.

El empaquetado de escritorio admite incluir un ejecutable `npi` **en Linux** cuando se suministra durante la construcción; es opcional, no una garantía para cada archivo publicado ni para otras plataformas. Por eso no es correcto decir que NeoCode siempre trae NeoPi, ni que siempre requiere una instalación separada: depende del paquete y del entorno. Si no hay uno incluido o accesible, se necesita un ejecutable compatible y su ruta disponible para el servidor. Tener NeoPi no configura por sí solo el acceso a los modelos.

## Una primera tarea

Abrí un proyecto al que tengas permiso de acceder, seleccioná NeoPi como proveedor y planteá un objetivo de lectura, por ejemplo:

> Encontrá dónde se valida el ingreso de clientes. Mostrame los archivos relevantes, explicá el recorrido y señalá dudas. No modifiques archivos ni datos.

Revisá las referencias contra el proyecto y pedí aclaraciones. Después podés solicitar una propuesta de cambio, acordar cómo verificarla y autorizar solamente las acciones apropiadas. No entregues secretos ni datos sensibles sin autorización. El resultado necesita revisión de alguien que conozca el dominio; la interfaz no transforma una respuesta plausible en evidencia.

## Local hoy; destinos futuros

Hoy el proveedor usa un proceso NeoPi en el entorno del servidor NeoCode; no precisa NeoCore. Esto no implica que NeoCore remoto ya exista. Se propone un daemon NeoCore sin interfaz, basado en código del motor de NeoPi, con empaquetado y forma de compartir código aún por decidir. NeoPi conservaría su motor local. La intención futura es elegir desde los entornos de NeoCode entre un agente alojado por la aplicación, un daemon local o uno remoto, y guardar conexiones para volver al trabajo en curso. El daemon mantendría los agentes mientras las interfaces se conectan y desconectan. No es una promesa de implementación ni una guía de configuración actual.

La propuesta de oficina también incluye NeoProxy para acceso a modelos y NeoDeck como tablero web, con acceso remoto seguro a definir. Sus cuentas, despliegue y conexión entre servicios no están configurados por esta guía.
