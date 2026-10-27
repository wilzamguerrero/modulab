# modulab 


Te voy a preparar un plan técnico que puedas pasarle directamente a una IA de programación para que construya la plataforma por etapas, sin intentar desarrollar todo de golpe.

La idea es crear un editor web 3D de espacios para eventos, exposiciones y muestras académicas, pensado inicialmente para el MAD de la Universidad de Nariño, pero reutilizable para otros eventos, instituciones y recintos.

La decisión más importante es esta: no construir un modelador 3D completo como Blender, sino un editor especializado en plantas, mobiliario y espacios expositivos. El usuario dibuja una planta sencilla, el sistema genera el piso y las paredes, arrastra modelos 3D desde un catálogo, asigna expositores y publica un enlace para que cualquier persona pueda explorar el espacio.

El sistema debe guardar tanto la geometría como los datos del proyecto, para que puedas volver a editarlo sin reconstruirlo.

# Plan maestro de desarrollo

## Plataforma web para diseñar, organizar y publicar espacios 3D interactivos

**Nombre provisional:** MAD Space Studio\
**Tipo de proyecto:** Aplicación web de edición 3D y publicación de recorridos interactivos.\
**Objetivo:** Crear una herramienta que permita construir espacios expositivos sin conocimientos de modelado 3D ni programación, utilizando geometrías básicas y modelos 3D previamente preparados.

---

# 1. Objetivo general

Desarrollar una plataforma web en la que un usuario pueda:

1. Crear un proyecto para un evento.
2. Dibujar la planta de un recinto desde una vista superior.
3. Generar automáticamente el piso y las paredes a partir de la forma dibujada.
4. Ajustar las dimensiones y la altura de los elementos arquitectónicos.
5. Insertar objetos 3D desde un catálogo de mobiliario y elementos básicos.
6. Mover, rotar, duplicar, escalar y eliminar objetos.
7. Modificar colores y materiales básicos.
8. Agregar y configurar luces.
9. Crear puntos de interés asociados a personas, stands, fotografías y descripciones.
10. Guardar el proyecto para continuar editándolo posteriormente.
11. Publicar una versión de solo lectura mediante un enlace compartible.
12. Permitir que los visitantes exploren el recinto en 3D y seleccionen un expositor para desplazarse hasta su ubicación.

El sistema debe ser reutilizable en diferentes eventos y recintos. No debe depender de un archivo de Blender específico ni requerir la reconstrucción manual de una escena para cada edición.

# 2. Principios de arquitectura

## 2.1. Separar el editor del visor público

La aplicación debe tener dos experiencias diferenciadas.

**Editor privado**

- Herramientas para dibujar la planta.
- Generación y edición de paredes y pisos.
- Catálogo de objetos 3D.
- Transformación de objetos.
- Materiales e iluminación.
- Gestión de expositores.
- Configuración de cámaras y puntos de interés.
- Guardado, duplicación y publicación.

**Visor público**

- Carga del espacio publicado.
- Vista inicial del recinto.
- Listado de expositores.
- Fichas con fotografías y descripciones.
- Selección de un expositor para mover la cámara hasta su ubicación.
- Navegación libre y rotación alrededor de los stands.
- Resaltado visual del punto seleccionado.

El visor público no debe cargar todas las herramientas de edición. Esto ayudará a simplificar la interfaz y mejorar el rendimiento.

## 2.2. Separar los datos de los modelos 3D

Los archivos GLB contienen la geometría, los materiales incorporados y otros recursos 3D. La distribución del recinto, las personas, los puntos de interés y la configuración del proyecto deben guardarse como datos estructurados independientes.

Así, modificar el nombre o la fotografía de un expositor no requiere exportar nuevamente la escena 3D.

## 2.3. No implementar un modelador 3D genérico

El objetivo no es competir con Blender.

El editor debe resolver las necesidades específicas de un montaje expositivo: plantas regulares, paredes rectas, mobiliario, objetos básicos, materiales sencillos y puntos de interés.

Las formas arquitectónicas complejas, las esculturas y los elementos personalizados podrán incorporarse como modelos GLB preparados externamente.

# 3. Tecnologías recomendadas

Utilizar una arquitectura web basada en TypeScript.

| Componente              | Tecnología recomendada                              | Función                                                         |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| Interfaz                | React + TypeScript                                  | Editor, paneles y formularios                                   |
| Escena 3D               | Three.js mediante React Three Fiber                 | Visualización y manipulación 3D                                 |
| Utilidades 3D           | Drei                                                | Controles de cámara, carga de modelos y herramientas auxiliares |
| Estado del editor       | Zustand                                             | Selección, herramientas, transformaciones y estado temporal     |
| Validación de datos     | Zod                                                 | Validar proyectos y configuraciones                             |
| Formularios             | React Hook Form, si resulta útil                    | Gestión de formularios                                          |
| Persistencia inicial    | IndexedDB                                           | Guardado local durante el desarrollo del MVP                    |
| Base de datos posterior | PostgreSQL mediante Supabase                        | Proyectos, usuarios y publicaciones                             |
| Archivos y fotografías  | Almacenamiento compatible con S3 o Supabase Storage | Modelos GLB, imágenes y recursos                                |
| Despliegue              | Vercel o Cloudflare                                 | Publicación de la aplicación                                    |

No es obligatorio utilizar todas estas bibliotecas desde el primer día. La IA debe comprobar las dependencias existentes y justificar cualquier incorporación.

**Formato 3D preferido: GLB.** Los modelos OBJ podrán aceptarse mediante conversión previa a GLB. GLB ofrece una vía más sencilla para distribuir geometría, materiales y texturas en la web.

Documentación de referencia:

- React: [https://react.dev/](https://react.dev/)
- React Three Fiber: [https://r3f.docs.pmnd.rs/](https://r3f.docs.pmnd.rs/)
- Three.js: [https://threejs.org/docs/](https://threejs.org/docs/)
- Drei: [https://drei.docs.pmnd.rs/](https://drei.docs.pmnd.rs/)
- Zustand: [https://zustand.docs.pmnd.rs/](https://zustand.docs.pmnd.rs/)
- Supabase: [https://supabase.com/docs](https://supabase.com/docs)

# 4. Arquitectura funcional

Organizar el sistema en módulos independientes, con responsabilidades bien definidas.

## Módulo A. Gestión de proyectos

Responsabilidades:

- Crear un proyecto.
- Definir nombre, descripción, evento y dimensiones iniciales.
- Abrir un proyecto existente.
- Guardar cambios.
- Duplicar proyectos.
- Mostrar el estado de guardado.
- Preparar la publicación.

Cada proyecto tendrá un identificador único y una estructura de datos versionada.

## Módulo B. Editor de planta 2D

Será una de las herramientas principales.

Crear una vista superior en la que el usuario pueda dibujar el contorno del recinto mediante vértices y segmentos rectos.

Funciones:

- Crear un polígono haciendo clic para agregar vértices.
- Cerrar la forma para definir el recinto.
- Dibujar plantas rectangulares, en L, en T y otras formas poligonales simples.
- Mostrar una cuadrícula.
- Ajustar las posiciones a la cuadrícula (snap).
- Introducir dimensiones numéricas.
- Mover, agregar y eliminar vértices.
- Deshacer y rehacer operaciones.
- Configurar unidades en metros.
- Definir la altura de las paredes.
- Definir el grosor de las paredes.

El sistema debe validar que el polígono esté cerrado, no tenga autointersecciones y tenga un área válida.

La planta debe generar automáticamente una geometría 3D:

- Un piso con el contorno exacto del polígono.
- Paredes a lo largo de los segmentos seleccionados como paredes.
- Espesor y altura configurables.
- Posibilidad de dejar segmentos abiertos para entradas, puertas o pasos.

No utilizar una caja rectangular como sustituto de la forma dibujada. El piso debe respetar la geometría real de la planta.

**Criterio de aceptación:** dibujar una planta en forma de T, cerrar el polígono y obtener un piso 3D y paredes coherentes con el contorno, sin tener que modelarlos manualmente.

## Módulo C. Vista 3D del recinto

Mostrar el espacio generado en una escena 3D.

Funciones:

- Vista en perspectiva.
- Órbita alrededor del recinto.
- Zoom y desplazamiento.
- Vista superior ortográfica.
- Vista frontal o lateral cuando resulte útil.
- Cuadrícula y ejes de referencia.
- Selección de objetos mediante clic.
- Indicadores de selección.
- Alternancia entre planta 2D y vista 3D.

El editor debe permitir trabajar en planta y comprobar los resultados en 3D sin perder la selección ni la configuración de los objetos.

## Módulo D. Catálogo de modelos 3D

Crear un catálogo visual que muestre miniaturas y nombres de los recursos disponibles.

Categorías iniciales:

- Mesas.
- Sillas.
- Paneles expositivos.
- Mostradores.
- Mobiliario adicional.
- Cajas.
- Esferas.
- Cilindros.
- Cubos y otras formas básicas.
- Objetos personalizados importados.

Cada recurso debe tener metadatos:

- Identificador.
- Nombre.
- Categoría.
- Ruta del archivo GLB, si corresponde.
- Miniatura.
- Dimensiones de referencia.
- Punto de origen o pivote.
- Escala de referencia.
- Configuración de materiales modificables.
- Versión del recurso.

El usuario debe poder arrastrar un objeto desde el catálogo hasta la escena o seleccionarlo y colocarlo mediante clic.

Para objetos que se arrastren sobre la vista 3D, utilizar una proyección del cursor sobre el plano del piso.

Incluir herramientas para:

- Mover.
- Rotar.
- Escalar.
- Duplicar.
- Eliminar.
- Alinear con la cuadrícula.
- Ajustar al piso.
- Copiar y pegar.
- Deshacer y rehacer transformaciones.

El usuario debe poder mover un objeto sin modificar accidentalmente otros elementos de la escena.

## Módulo E. Materiales y colores

Implementar un sistema básico de materiales.

Funciones:

- Cambiar el color del piso.
- Cambiar el color de cada pared.
- Cambiar el color de objetos compatibles.
- Configurar rugosidad.
- Configurar metalicidad.
- Elegir entre materiales predefinidos.
- Restablecer el material original.

No se requiere desarrollar un editor avanzado de texturas en la primera versión.

Cuando un GLB tenga varios materiales, permitir modificar los materiales autorizados sin destruir la estructura original del modelo.

El sistema debe definir cómo se gestionan las modificaciones de materiales por instancia, evitando que cambiar el color de una silla modifique automáticamente todas las sillas del proyecto, salvo que el usuario lo solicite.

## Módulo F. Iluminación

Incorporar un panel sencillo de iluminación.

Tipos iniciales:

- Luz ambiental o hemisférica.
- Luz direccional.
- Luz puntual.
- Luz tipo foco, si se necesita para destacar stands.

Parámetros:

- Intensidad.
- Color.
- Posición.
- Dirección, cuando corresponda.
- Alcance o ángulo del foco, cuando corresponda.
- Activar o desactivar la luz.

Permitir seleccionar luces desde la escena y desde un listado de iluminación.

Implementar límites razonables al número de luces y evitar sombras costosas por defecto, especialmente en dispositivos móviles.

La iluminación del editor debe funcionar en tiempo real, sin depender de un render precalculado en Blender.

## Módulo G. Expositores y puntos de interés

Este módulo conecta la escena con las personas que participarán en el evento.

Cada punto de interés debe contener:

- Identificador único.
- Nombre del expositor o proyecto.
- Fotografía opcional.
- Descripción.
- Número o código de stand.
- Posición dentro de la escena.
- Orientación.
- Lista de objetos asociados.
- Posición objetivo de la cámara.
- Distancia de visualización preferida.
- Estado de publicación.

Permitir crear un punto de interés seleccionando una ubicación en el recinto.

El punto puede mostrarse mediante un marcador en el editor, pero ese marcador no tiene que aparecer necesariamente en la experiencia pública.

La ficha del expositor debe poder editarse sin cambiar la geometría del recinto.

Debe ser posible importar o editar los datos mediante un formulario. La importación masiva desde CSV podrá añadirse posteriormente.

## Módulo H. Navegación y cámaras

La experiencia pública debe permitir recorrer el recinto de dos maneras.

**Navegación libre**

- Girar alrededor de la escena.
- Acercarse y alejarse.
- Desplazarse por el espacio.
- Volver a la vista inicial.

**Navegación por puntos de interés**

- Seleccionar un nombre en el listado.
- Mover suavemente la cámara hacia el stand correspondiente.
- Orientar la vista para observar el mobiliario.
- Permitir que el visitante rote la cámara alrededor del punto seleccionado.
- Mostrar una ficha con la información del expositor.
- Pasar directamente a otro expositor.

Cada punto de interés debe tener una posición objetivo de cámara independiente de la posición exacta del expositor. Así se puede elegir una vista agradable sin que la cámara termine dentro de una pared o de un mueble.

Incluir una función para restablecer la cámara y detectar situaciones en las que una vista objetivo no sea válida.

La navegación pública no debe permitir atravesar indiscriminadamente las paredes. Si se incorpora movimiento libre en primera persona, añadir colisiones o restricciones de desplazamiento.

## Módulo I. Guardado y persistencia

Durante el MVP, guardar el proyecto en el navegador mediante IndexedDB.

Requisitos:

- Guardado manual.
- Guardado automático controlado.
- Recuperación del proyecto después de cerrar el navegador.
- Indicador de cambios pendientes.
- Versionado del esquema de datos.
- Validación al cargar un proyecto.
- Manejo de errores de guardado.

En la siguiente fase, incorporar cuentas de usuario, base de datos y almacenamiento remoto para permitir que un proyecto se abra desde diferentes dispositivos.

No guardar toda la escena como una imagen ni depender exclusivamente de un archivo GLB exportado.

## Módulo J. Publicación y visor compartido

Implementar la publicación después de validar el editor básico.

Al pulsar «Publicar», el sistema debe:

1. Validar el proyecto.
2. Guardar una versión publicada de los datos.
3. Asociar un identificador público al proyecto.
4. Generar una URL compartible.
5. Abrir el visor público.
6. Permitir actualizar la publicación cuando el editor publique una nueva versión.

Ejemplo ilustrativo:

`https://dominio.com/e/mad-2026`

El enlace no debe depender de la sesión privada del editor.

El visor debe ser de solo lectura: los visitantes no pueden mover los muebles, cambiar materiales ni modificar los datos.

Distinguir entre el borrador editable y la versión publicada, para que los cambios posteriores no se hagan visibles antes de publicar.

Implementar controles de acceso y validación para impedir que una URL pública permita editar o eliminar proyectos.

# 5. Modelo de datos

Definir un esquema central de datos que represente la escena completa.

Como mínimo, debe incluir:

**Proyecto**

- ID.
- Nombre.
- Descripción.
- Unidades.
- Configuración general.
- Geometría de la planta.
- Parámetros de paredes y piso.
- Objetos colocados.
- Luces.
- Puntos de interés.
- Configuración de cámara.
- Versión del esquema.
- Estado de publicación.

**Instancia de objeto**

- ID de instancia.
- ID del recurso del catálogo.
- Posición XYZ.
- Rotación.
- Escala.
- Materiales sobrescritos.
- Visibilidad.
- Datos opcionales de asociación con un expositor.

**Punto de interés**

- ID.
- Nombre.
- Descripción.
- Fotografía.
- Posición.
- Objetivo de cámara.
- Referencias a los objetos relacionados.

Cada objeto colocado en la escena debe ser una instancia independiente de un recurso del catálogo. Varias instancias pueden reutilizar el mismo archivo GLB sin duplicar innecesariamente el recurso.

Guardar los datos geométricos de la planta como un polígono con unidades conocidas y parámetros explícitos. Generar el piso y las paredes a partir de esos datos cuando se abra el proyecto.

# 6. Organización del código

Si el proyecto comienza desde cero, utilizar una estructura modular semejante a esta:

```
src/
  app/
    routes/
    layout/
  components/
    editor/
    catalog/
    inspector/
    forms/
  features/
    projects/
    floor-plan/
    architecture/
    scene/
    objects/
    materials/
    lighting/
    exhibitors/
    camera/
    publishing/
  three/
    loaders/
    geometry/
    controls/
    selection/
    materials/
    lighting/
  data/
    schemas/
    migrations/
    serialization/
  services/
    storage/
    projects/
    assets/
    publishing/
  store/
  types/
  utils/
```

La estructura puede adaptarse al repositorio real. No crear carpetas vacías ni duplicar responsabilidades.

Separar como mínimo:

- Estado temporal de la interfaz.
- Datos persistentes del proyecto.
- Geometría calculada de la escena.
- Componentes de visualización 3D.
- Operaciones de edición.
- Servicios de almacenamiento.
- Publicación y lectura pública.

El código de geometría no debe depender directamente de los formularios o del diseño visual de la interfaz.

# 7. Plan de desarrollo por fases

## Fase 0. Auditoría y preparación

Antes de escribir código:

- Revisar el repositorio existente, si lo hay.
- Identificar tecnologías, dependencias y funcionalidades ya implementadas.
- Definir convenciones de coordenadas, unidades y escalas.
- Crear el esquema inicial de datos.
- Definir cómo se importarán y validarán los modelos 3D.
- Crear un documento de decisiones técnicas.
- Preparar una lista de tareas verificables.

**Resultado:** arquitectura acordada y entorno listo para desarrollar.

## Fase 1. MVP geométrico

Construir únicamente:

- Una interfaz de editor.
- Una cuadrícula en vista superior.
- Dibujo de polígonos cerrados.
- Edición de vértices.
- Generación del piso.
- Generación de paredes.
- Altura y grosor de paredes configurables.
- Vista 3D y navegación básica.

Utilizar una planta de prueba rectangular y otra en forma de T.

**Resultado esperado:** el usuario dibuja un recinto y obtiene un espacio 3D coherente.

No avanzar hasta comprobar la generación geométrica, incluidas las formas cóncavas y las entradas abiertas.

## Fase 2. Catálogo y edición de objetos

Añadir:

- Catálogo de modelos.
- Carga de archivos GLB.
- Objetos básicos.
- Inserción de objetos en el piso.
- Movimiento, rotación y escala.
- Duplicación y eliminación.
- Selección y deselección.
- Ajuste a cuadrícula.
- Inspector de transformaciones.
- Detección y gestión de errores de carga.

Utilizar inicialmente tres modelos reales del mobiliario disponible.

**Resultado esperado:** crear un recinto y colocar muebles sin utilizar Blender durante la edición.

## Fase 3. Materiales, luces y guardado local

Añadir:

- Cambios de color.
- Materiales básicos.
- Luces configurables.
- Guardado local.
- Carga del proyecto guardado.
- Deshacer y rehacer.
- Validación de datos.
- Recuperación después de recargar la página.

**Resultado esperado:** un proyecto se puede crear, guardar, cerrar y volver a editar conservando la escena.

## Fase 4. Expositores y puntos de interés

Añadir:

- Creación de expositores.
- Fotografías y descripciones.
- Asociación con stands.
- Marcadores en el editor.
- Posición y orientación de cámara.
- Listado de personas.
- Edición de fichas.
- Relación entre los muebles y los puntos de interés.

**Resultado esperado:** cada expositor tiene una ubicación y una ficha informativa independiente.

## Fase 5. Visor público interactivo

Añadir:

- Vista pública de solo lectura.
- Navegación libre.
- Listado de expositores.
- Transiciones suaves de cámara.
- Resaltado del stand seleccionado.
- Fichas informativas.
- Rotación de cámara alrededor del punto seleccionado.
- Adaptación a móviles y tabletas.
- Vista inicial y controles de regreso.

**Resultado esperado:** un visitante puede explorar el recinto sin acceder al editor.

## Fase 6. Publicación y almacenamiento remoto

Añadir:

- Autenticación para editores.
- Base de datos remota.
- Almacenamiento de modelos y fotografías.
- Guardado en la nube.
- Publicación mediante URL.
- Separación entre borrador y versión publicada.
- Permisos de acceso.
- Actualización de publicaciones.
- Gestión de errores de red.

**Resultado esperado:** publicar un proyecto y compartirlo con personas que no tienen cuenta.

## Fase 7. Optimización y preparación para producción

Añadir o revisar:

- Optimización de modelos GLB.
- Compresión de geometría y texturas cuando resulte conveniente.
- Carga diferida de recursos.
- Reutilización de geometrías y materiales.
- Límites razonables de luces y sombras.
- Pruebas de rendimiento en móviles.
- Validación de archivos importados.
- Copias de seguridad y recuperación de proyectos.
- Accesibilidad básica.
- Pruebas de navegación y publicación.

**Resultado esperado:** una plataforma estable, reutilizable y suficientemente eficiente para eventos reales.

# 8. Requisitos de calidad

La IA debe cumplir estas reglas durante todo el desarrollo:

1. No implementar todas las fases en una sola operación.
2. No reemplazar funcionalidades existentes sin revisar primero el repositorio.
3. No utilizar geometría ficticia para simular una funcionalidad terminada.
4. No guardar únicamente el resultado visual de la escena.
5. No acoplar los datos de expositores al archivo GLB.
6. No crear una API o base de datos innecesaria durante el MVP.
7. No introducir dependencias sin justificar su utilidad.
8. Mantener tipado estricto en TypeScript.
9. Separar los componentes de interfaz de las funciones geométricas.
10. Validar todos los datos de entrada.
11. Evitar que errores en un modelo GLB bloqueen el editor completo.
12. Probar las funcionalidades antes de avanzar a la fase siguiente.
13. Mantener documentación actualizada.
14. Entregar código funcional, no solo ejemplos o pseudocódigo.
15. Conservar una ruta clara para añadir nuevas funciones sin rehacer la arquitectura.

# 9. Criterios de aceptación del MVP

El MVP inicial se considera terminado cuando se pueda:

- Crear un proyecto nuevo.
- Dibujar un piso rectangular y uno con forma de T.
- Generar paredes con una altura configurable.
- Insertar al menos tres modelos GLB.
- Mover, rotar, escalar y duplicar los objetos.
- Cambiar el color del piso y de una pared.
- Guardar el proyecto en el navegador.
- Recargar la aplicación y recuperar el proyecto.
- Volver a editar la escena sin perder los objetos.
- Comprobar que las dimensiones y posiciones sean coherentes en 2D y 3D.

No es necesario tener publicación pública, cuentas de usuario ni todas las luces configurables para completar esta primera etapa.

# 10. Instrucciones para trabajar con la IA

La IA debe trabajar como desarrolladora principal de la plataforma.

Al comenzar:

1. Auditar el repositorio y resumir su estado.
2. Proponer la arquitectura definitiva según el código existente.
3. Definir el esquema de datos inicial.
4. Dividir la Fase 1 en tareas pequeñas.
5. Implementar la primera tarea.
6. Ejecutar las pruebas pertinentes.
7. Informar qué archivos modificó y qué se puede probar.
8. Continuar con la siguiente tarea sin adelantarse a las fases futuras.

Cada entrega debe incluir:

- Funcionalidad implementada.
- Archivos creados o modificados.
- Decisiones técnicas relevantes.
- Pruebas ejecutadas y sus resultados.
- Limitaciones conocidas.
- Próxima tarea recomendada.

No afirmar que una funcionalidad funciona si no se ha probado.

---

# 11. Prompt inicial para la IA de programación

Actúa como una ingeniera de software sénior especializada en aplicaciones web 3D, React, TypeScript y Three.js.

Vamos a desarrollar una plataforma web para diseñar espacios expositivos y publicar recorridos 3D interactivos.

Lee y utiliza el plan maestro anterior como especificación del producto.

La aplicación permitirá dibujar plantas poligonales, generar pisos y paredes, insertar modelos GLB desde un catálogo, editar sus transformaciones, configurar materiales y luces, asignar expositores a ubicaciones, y publicar una experiencia 3D navegable mediante una URL.

La plataforma debe funcionar como un editor especializado, no como un modelador 3D genérico.

**En esta primera etapa no implementes toda la plataforma.**

Comienza auditando el repositorio actual. Si todavía no existe un proyecto, propón una estructura mínima y crea únicamente la base necesaria para la primera fase.

Después, implementa el MVP geométrico:

1. Crear una vista de planta 2D con cuadrícula.
2. Permitir dibujar un polígono mediante vértices.
3. Permitir cerrar y editar el polígono.
4. Validar la geometría antes de generar la escena.
5. Generar un piso 3D que respete exactamente el contorno.
6. Generar paredes a lo largo de los segmentos definidos como paredes.
7. Permitir configurar altura y grosor.
8. Mostrar una vista 3D navegable.
9. Mantener sincronizadas las vistas 2D y 3D.
10. Probar plantas convexas y cóncavas, incluyendo una forma de T.

Utiliza React, TypeScript, Three.js y React Three Fiber, salvo que la auditoría justifique otra decisión.

Mantén la geometría, los datos persistentes y la interfaz separados. Define unidades y coordenadas de forma consistente. Prepara una estructura de datos versionada que permita guardar posteriormente el proyecto como datos editables.

No incorpores todavía autenticación, publicación pública, gestión completa de expositores ni un sistema avanzado de iluminación.

Al terminar, ejecuta las pruebas pertinentes, informa de los archivos modificados y presenta los pasos para ejecutar y verificar el resultado.

**No avances a la siguiente fase hasta que la generación de plantas y paredes esté funcionando correctamente.**

# 12. Visión final del producto

El resultado será una herramienta en la que una persona sin experiencia en software 3D pueda crear un recinto, distribuir el mobiliario disponible, asociar fotografías y descripciones a los expositores y publicar una experiencia interactiva.

La plataforma no dependerá de un proyecto de Blender preparado previamente. Blender seguirá siendo útil para producir o corregir modelos personalizados, pero no será un requisito para organizar cada nuevo evento.

La primera meta es un editor geométrico funcional. La segunda es convertirlo en una herramienta de montaje. La tercera es ofrecer una experiencia pública compartible y reutilizable.

## Mi recomendación antes de empezar

Hay tres decisiones que tomaría desde el principio:

- GLB como formato estándar: entrega tus modelos de mobiliario en GLB siempre que sea posible. Si tienes OBJ, conviene convertirlos y comprobar sus materiales antes de incorporarlos al catálogo.
- Datos editables independientes: guarda la planta, las coordenadas, los materiales y los expositores como datos del proyecto. No dependas de exportar toda la escena después de cada cambio.
- Primero geometría, después publicación: no le pidas a la IA que construya las siete fases simultáneamente. La generación fiable de plantas irregulares y paredes es la base de todo el sistema.

Una precisión técnica importante: para las paredes, no basta con extruir todo el contorno indiscriminadamente. Conviene que el editor permita definir qué segmentos son paredes y cuáles son accesos abiertos. Así podrás representar entradas y espacios conectados sin tener que buscar soluciones improvisadas más adelante.

El primer entregable que yo le pediría a la IA es una demostración funcional en la que dibujas una planta en forma de T, aparecen el piso y las paredes, y puedes recorrerlos en 3D. Cuando eso esté bien resuelto, incorporar el catálogo de mobiliario será el siguiente paso natural.


por ultimo toma este otro proyecto Toma este otro proyecto, donde aquí utilizo Notion para guardar datos. En este proyecto, yo lo utilizaba para guardar trabajos que me enviaban los estudiantes.

En este caso, vamos a utilizar el mismo sistema, donde pueda colocar el lugar de la página de Notion donde pueda guardar los proyectos. Así, por ejemplo, cuando ingresa al modo editor, si lo quieres ver en la plataforma de Modulap, pueda guardar los cambios y esos cambios se guarden en Notion. Así, cuando vuelva a abrir la página, que ingrese como modo editor, me aparezcan estos archivos y pueda seleccionar qué tanto se va a guardar allí.

Por ejemplo, que esté en una pestaña, en un toggle list, las personas y, dentro de la de la persona, esté el dato que se va a mostrar, tal vez imágenes o textos ahí mismo. Entonces, si yo llego y edito alguno de esos por fuera, también se va a editar en la visualización para que sea mucho más fácil y tenga un lugar donde alojar esos archivos. revisa lo que mas nos convenga para usar a notion como lugar para guardar estos datos y asi puedo tener un historico yp doer ver proyectos anteriores o nuevos entiendes E:\escrito 2026\documentos\modulab\Reference\UpZ

---

# 13. Implementación de Modulab

> Esta sección se añade al plan original. Las secciones 1–12 se conservan como especificación del producto; aquí se documenta lo que ya está construido, cómo ejecutarlo y qué falta por validar.

## 13.1. Estado de la entrega

Modulab es una aplicación web local-first con dos experiencias separadas:

- **Editor privado** en `/` y `/editor/:projectId`.
- **Visor público de solo lectura** en `/e/:publicId`.

El cliente está hecho con React 19, TypeScript, Vite, React Three Fiber, Drei, Zustand y Zod. El servidor es una aplicación Express que resuelve el catálogo dinámico, las subidas de archivos, la integración con Notion y la publicación de instantáneas.

La app no guarda una imagen ni un GLB exportado como sustituto del proyecto. Guarda un JSON versionado con la planta, los muros, los objetos, los materiales, las luces, los expositores y las cámaras. La escena 3D se reconstruye a partir de esos datos.

**Verificado en esta entrega:** TypeScript estricto, 30 pruebas automatizadas, build de producción, flujo de planta en T, catálogo dinámico con un GLB de prueba, publicación y visor público con cámara de expositor. También se comprobó en navegador que orbitar la cámara y después cambiar metadatos o mover un objeto no devuelve la vista a la cámara inicial; el botón de cámara del proyecto sí la restaura de forma explícita.

**Pendiente de validar con material real:** modelos GLB del usuario y la API real de Notion. No se afirma que esos dos puntos funcionen hasta probarlos con los archivos y credenciales definitivos.

## 13.2. Requisitos y puesta en marcha

Requisitos:

- Node.js 20.19 o superior (el proyecto se probó con Node 24.21).
- npm.

```powershell
npm install
npm run dev
```

Abrir `http://localhost:3000`.

Comandos disponibles:

| Comando | Función |
| --- | --- |
| `npm run dev` | Servidor Express + Vite en modo desarrollo, con recarga en caliente. |
| `npm run build` | Genera el cliente en `dist/` y empaqueta el servidor en `dist/server.cjs`. |
| `npm start` | Ejecuta el build de producción en el puerto configurado. |
| `npm run lint` | Ejecuta `tsc --noEmit`. |
| `npm test` | Ejecuta todas las pruebas con Vitest. |
| `npm run test:watch` | Vitest en modo interactivo. |

`npm install` ejecuta `scripts/copy-draco.mjs`, que copia el decodificador Draco a `public/draco`. Si se instala con scripts desactivados, ejecutar `node scripts/copy-draco.mjs` una vez.

Variables de entorno opcionales (ver `.env.example`):

```env
NOTION_SECRET=
NOTION_ID_PAGE=
PORT=3000
MODULAB_DATA_DIR=
```

- `NOTION_SECRET` y `NOTION_ID_PAGE` permiten configurar Notion sin abrir la interfaz. También se acepta `NOTION_PARENT_PAGE_ID`.
- `PORT` cambia el puerto del servidor (3000 por defecto).
- `MODULAB_DATA_DIR` cambia la carpeta de datos del servidor; por defecto es `data/`.
- La configuración guardada desde la interfaz se escribe en `data/notion-config.json` y tiene prioridad sobre las variables de entorno. Ese archivo está ignorado por Git.

Para producción:

```powershell
npm run build
npm start
```

El servidor de producción sirve `dist/` y aplica el fallback de SPA para `/editor/...` y `/e/...`.

## 13.3. Estructura del repositorio

```text
server.ts                 Servidor Express y rutas de API
server/
  config.ts               Rutas de datos, configuración de Notion y entorno
  notion.ts               Bloques, proyectos, personas e imágenes de Notion
  catalog.ts              Escaneo recursivo y subida de modelos
  publishing.ts           Publicaciones locales y espejo en Notion
  uploads.ts              Fotografías de expositores
src/
  components/
    editor/               Paneles del editor e inspector
    plan/                 Editor de planta 2D
    scene/                Piso, muros, objetos, luces y marcadores 3D
    viewer/               Escena pública
    projects/             Tarjetas y creación de proyectos
    settings/             Configuración de Notion y atajos
    ui/                   Componentes reutilizables
  data/                   Esquema, valores por defecto y plantillas
  pages/                  Inicio, editor y visor público
  services/
    assets/               Carga GLB, materiales y catálogo
    notion/               Sincronización de personas
    projects/             Persistencia, exportación e importación
    publishing/           Publicación y lectura pública
    storage/              IndexedDB
    thumbnails/           Miniaturas generadas en el navegador
  store/                  Zustand: editor, interfaz y materiales
  types/                  Esquema Zod y tipos del proyecto
  utils/                  Geometría, formato, identificadores y slugs
public/
  catalog/                Modelos GLB/GLTF del usuario
  draco/                  Decodificador Draco local
data/
  published/              Instantáneas publicadas
  uploads/                Fotografías subidas
scripts/
  copy-draco.mjs          Copia el decodificador en la instalación
```

La geometría vive en `src/utils/geometry.ts` y en los componentes de escena; no depende de los formularios. El estado temporal de la interfaz está en Zustand; los datos persistentes son el `Project` validado por Zod.

## 13.4. Catálogo GLB dinámico

### Dónde copiar los modelos

Copiar los archivos en:

```text
E:\escrito 2026\documentos\modulab\public\catalog
```

También se pueden crear subcarpetas:

```text
public/catalog/
  mesas/
    mesa-redonda.glb
  sillas/
    silla-negra.glb
  paneles/
    panel-grande.glb
  caja-de-prueba.glb
```

El servidor recorre `public/catalog` de forma recursiva en cada `GET /api/catalog`. No hay que editar ningún listado ni reiniciar el servidor. En el editor, usar el botón de recarga del panel **Catálogo** después de copiar archivos.

Reglas del catálogo:

- El nombre visible es el nombre del archivo sin la extensión. `mesa-redonda.glb` aparece como **mesa-redonda**.
- La carpeta se usa como categoría. Una subcarpeta anidada se muestra como `mesas / redondas`.
- Se aceptan `.glb` y `.gltf`.
- El panel también permite subir archivos; se guardan en la raíz del catálogo con un nombre saneado.
- La subida acepta hasta 300 MB por archivo.
- Las miniaturas se generan en el navegador con un renderer fuera de pantalla y se cachean por identificador y fecha de modificación.
- Los modelos se normalizan al colocarlos: se centran horizontalmente y su base queda sobre el piso. La escala inicial es 1:1 y se ajusta desde el inspector.

### Limitaciones del catálogo

- **GLB es el formato recomendado.** Un `.gltf` puede referenciar un `.bin` y texturas externas. El escaneo encuentra el `.gltf`, pero el navegador necesita esas rutas relativas. Si se copia un `.gltf` manualmente, copiar también sus recursos conservando la estructura de carpetas. La subida desde el panel envía un solo archivo, así que no es suficiente para un `.gltf` con recursos externos.
- Se soportan Draco y Meshopt. El decodificador Draco se sirve localmente desde `/draco/`.
- No se reproducen animaciones GLB; el modelo se muestra en su pose estática.
- Los controles de materiales están pensados para `MeshStandardMaterial`. Materiales exóticos pueden aparecer sin todos los controles.
- Si un modelo falla, el error se muestra en su tarjeta o en el objeto; no debería bloquear el resto del editor.

## 13.5. Editor de planta y escena 3D

### Planta 2D

- Cuadrícula configurable y ajuste a cuadrícula.
- Herramienta de dibujo por vértices; el polígono se cierra al hacer clic en el primer vértice.
- Edición de vértices, longitud de segmentos y activación/desactivación de muros por segmento.
- Validación de autointersecciones, área mínima, vértices duplicados y número máximo de vértices.
- Desplazamiento, zoom y encuadre.
- Cotas y área.
- Plantillas: rectángulo, L, T, U y planta vacía.
- Los expositores y objetos se pueden arrastrar en planta; los objetos del catálogo se colocan haciendo clic dentro del polígono.

### Piso y muros 3D

- El piso se genera con `THREE.ShapeGeometry` a partir del polígono exacto. No se sustituye por una caja rectangular, por lo que las formas cóncavas, en L, T y U conservan su contorno.
- Cada segmento del polígono tiene su propia configuración de muro: activo/inactivo, altura, grosor y color.
- Los segmentos desactivados quedan abiertos para entradas, pasos o conexiones.
- Los muros son cajas rectas por segmento. Las esquinas se resuelven por solape; no hay ingleteado avanzado ni muros curvos.
- Cada muro se hunde 2 cm en el piso. Así se cierra la junta entre el muro y la losa y se evita la línea clara que aparecía en la base al proyectar sombras.
- No hay puertas ni ventanas paramétricas: se representan dejando el segmento abierto o colocando objetos.

### Objetos y materiales

- Inserción desde el catálogo o desde formas básicas (cubo, esfera, cilindro, cono).
- Selección, mover, rotar, escalar, duplicar, eliminar, copiar/pegar y ajustar a cuadrícula.
- Deshacer y rehacer.
- Asociación de un objeto a un expositor.
- Color, rugosidad y metalicidad del piso.
- Color de cada muro.
- Por objeto, modificación de cada material del GLB: color, rugosidad, metalicidad, opacidad y visibilidad.
- **Restablecer** devuelve el material a los valores originales del GLB. Cada instancia clona sus materiales, de modo que cambiar una silla no cambia las demás.
- El inspector muestra las ranuras de material disponibles y el estado de carga del modelo.

### Luces

Tipos: ambiental, hemisférica, direccional, puntual y foco. Parámetros: color, intensidad, posición, objetivo, distancia, ángulo, penumbra, sombras y activación. Las luces se pueden seleccionar desde la lista o desde la escena 3D. Las sombras son opcionales y conviene limitarlas en móviles.

### Sombras y calidad visual

- **Calidad de sombras:** Baja, Media y Alta, ajustable desde **Escena y ayudas** o desde el inspector del proyecto. Usa mapas de 1024, 2048 y 4096 px respectivamente. Se guarda dentro de `settings.shadowQuality` y se conserva al publicar.
- **Frustum ajustado:** la luz direccional calcula su cámara ortotográfica a partir de las dimensiones reales de la planta. Antes el frustum fijo de 60 × 60 m repartía pocos texels entre toda la escena; ahora la resolución se concentra en el recinto.
- **Bordes suaves:** en Media y Alta se activa PCSS mediante `SoftShadows` de Drei, con más muestras en Alta. La calidad Baja usa PCF suave con 1024 px para equipos modestos. PCSS es más costoso: en móviles conviene empezar por Baja.
- **Sesgo:** se usa `normalBias` en lugar de un sesgo negativo grande. Eso reduce el acné de sombra y evita que la sombra se separe de la base del muro.
- **Relleno ambiental:** `RoomEnvironment` genera un mapa PMREM local, sin descargar HDR externos. Aporta luz difusa a las caras interiores para que no queden negras, pero se mantiene bajo para no aplanar las sombras.
- **Piso:** se eliminó el `polygonOffset` del piso; el piso y la base de los muros ya no compiten en profundidad.

### Expositores y cámaras

Cada expositor guarda nombre, stand, descripción, fotografía, posición, rotación, cámara propia, objetos asociados, visibilidad y metadatos.

- Se puede crear con la herramienta **Expositor** o desde el panel.
- La ficha se edita en el inspector.
- La fotografía puede subirse a `data/uploads` o venir de una imagen de Notion.
- **Vista sugerida** calcula una cámara dentro de la planta. El algoritmo prioriza 3,5 m de distancia, comprueba que la cámara y el trayecto hasta el expositor estén dentro del polígono, exige separación de los muros y evita habitaciones cóncavas. Si no hay una posición válida, usa una vista elevada por encima de los muros.
- En el visor público, una cámara guardada que quede fuera del piso, pegada a un muro o demasiado cerca del objetivo se sustituye automáticamente por la vista sugerida.

## 13.6. Persistencia local

- Base de datos IndexedDB `modulab`, con almacenes `projects` y `settings`.
- `localStorage` se usa como respaldo para ajustes si IndexedDB no está disponible.
- Guardado automático controlado (aprox. 850 ms después del último cambio) y guardado manual con `Ctrl+S`.
- Indicador de cambios pendientes y errores de guardado.
- Exportación a un archivo `.modulab.json` con el proyecto editable completo.
- Importación validada con Zod; se crea un proyecto nuevo con identificador nuevo para no sobrescribir otro.
- Duplicación de proyectos desde el inicio.
- Esquema versionado (`schemaVersion: 1`). Al cargar se normalizan los muros que falten y se aplican valores por defecto.

Los proyectos locales pertenecen al perfil del navegador. Para moverlos a otro equipo, exportar el JSON e importarlo allí. Limpiar los datos del navegador elimina los proyectos locales; las publicaciones guardadas en el servidor no se borran al eliminar el proyecto local.

## 13.7. Notion

### Configuración

1. Crear una integración en <https://www.notion.so/my-integrations>.
2. Compartir la página padre con esa integración.
3. En Modulab, abrir **Conectar** y pegar el token y la URL o el ID de la página padre.
4. Guardar. El estado se puede comprobar en la misma ventana.

La página padre debe contener los proyectos como toggles o páginas hijas. Al guardar un proyecto nuevo en Notion, Modulab crea un toggle con su nombre y, dentro, un bloque de código JSON marcado con `__modulab_project__`. Al volver a guardar, actualiza ese mismo bloque y el título.

### Proyectos

- **Guardar en Notion** es manual; no se ejecuta en cada cambio.
- **Traer cambios desde Notion** pide confirmación porque reemplaza el proyecto local con lo que haya en Notion. Conserva el identificador local y la información de publicación.
- Editar directamente el JSON del bloque de código y volver a abrir o traer el proyecto refleja esos cambios.
- El proyecto se guarda como datos estructurados, no como imagen ni GLB.

### Personas y expositores

La página de personas puede ser la misma página del proyecto o una página aparte. Se puede indicar su URL o ID en el panel **Expositores**.

Estructura admitida:

```text
Personas del evento
└── Personas                      (toggle contenedor opcional)
    ├── A-01 - Ana Pérez          (toggle o página hija)
    │   ├── Stand: A-01
    │   ├── Proyecto: …
    │   ├── Rol: …
    │   ├── Descripción: …
    │   └── [imagen]
    └── B-02 - Carlos Gómez
        └── …
```

- El contenedor puede llamarse `Personas`, `Expositores`, `Participantes`, `Expositores y personas` o `Stands`. Si no existe, se leen los toggles o páginas hijas del nivel superior.
- El título puede incluir el código al principio: `A-01 - Ana Pérez`.
- Se reconocen líneas `Clave: valor` con alias en español e inglés: `nombre/name`, `proyecto/obra/titulo`, `stand/stand #/codigo/puesto`, `rol/categoria/carrera`, `correo/email`, `telefono/celular/whatsapp`, `instagram`, `web/enlace/url`, `descripcion/description`.
- Las líneas que no son campos se acumulan como descripción.
- La primera imagen del bloque se usa como fotografía.
- Los metadatos restantes se conservan y se muestran en la ficha.

La sincronización manual usa `refresh=1` para evitar la caché de 30 segundos del servidor. Los campos se **reemplazan**, no se fusionan: si se borra una descripción o un stand en Notion, al sincronizar desaparece también en Modulab. Los expositores creados a mano no se marcan como ausentes. Una persona eliminada en Notion se marca como **sin coincidencia** en el editor, se oculta del visor público y se puede quitar con el botón del panel. Esto evita perder posiciones y cámaras por un fallo temporal de la API.

Las imágenes de Notion se sirven a través de `/api/notion/image/:blockId` porque las URL originales caducan. El servidor las descarga y las cachea durante una hora.

### Límites de Notion

- El bloque JSON admite aproximadamente 190 000 caracteres. Un proyecto con imágenes incrustadas o datos enormes puede superar ese límite.
- La API de Notion tiene límites de frecuencia; el servidor limita la concurrencia y reintenta errores 429/5xx.
- No hay sincronización en tiempo real ni resolución de conflictos entre varias personas editando el mismo proyecto.
- El token de Notion se guarda en texto plano en `data/notion-config.json` (ignorado por Git). Hay que proteger esa carpeta y no publicarla.
- **No se ha probado contra la API real de Notion en esta entrega** porque no se proporcionaron credenciales. La lógica está implementada, pero debe validarse con una página real antes de confiar en ella para un evento.

## 13.8. Publicación y visor público

Al publicar:

1. Se valida el nombre y la planta. Las advertencias de mobiliario, expositores o muros abiertos no bloquean la publicación.
2. Se crea una instantánea independiente del proyecto actual.
3. Se asigna un identificador público estable a partir del nombre y del identificador del proyecto.
4. Se guarda en `data/published/<publicId>.json`.
5. Si el proyecto está vinculado a Notion, se intenta guardar también una copia en un bloque `__modulab_published__`. Si Notion falla, la publicación local sigue disponible.
6. Se devuelve la URL `/e/<publicId>`.

Características del visor:

- Solo lectura: no hay herramientas de edición.
- Carga la instantánea publicada, no el borrador.
- Listado de expositores, ficha con foto, descripción y objetos asociados.
- Salto suave a la cámara del expositor, anterior/siguiente, vista general y vista superior.
- Órbita, zoom y desplazamiento libre; no hay primera persona ni colisiones.
- Los expositores marcados como ausentes en Notion no se muestran.
- Diseño adaptable a móvil y tableta.
- Las rutas están separadas con `React.lazy`: el visor no descarga el módulo del editor.

La publicación es una copia de los **datos**, no de los GLB. El visor sigue cargando los modelos desde `/catalog/...`. Si se renombra, mueve o elimina un GLB, una publicación existente puede quedar con un objeto roto hasta que se republique o se restituya el archivo. Los cambios del editor no se ven en el visor hasta pulsar **Publicar nueva versión**.

El identificador público reduce la probabilidad de acceso casual, pero **no es autenticación**. No hay cuentas, permisos ni protección de las rutas de API. Para desplegar en internet hay que añadir autenticación y control de acceso al editor y a las rutas de escritura.

## 13.9. API del servidor

| Método | Ruta | Función |
| --- | --- | --- |
| GET | `/api/health` | Estado del servidor. |
| GET | `/api/catalog` | Escanea y devuelve los modelos del catálogo. |
| POST | `/api/catalog/upload` | Sube un `.glb` o `.gltf` (campo `file`). |
| POST | `/api/uploads/photo` | Sube una fotografía de expositor (campo `file`). |
| GET | `/api/notion/config` | Estado de la configuración de Notion. |
| POST | `/api/notion/config` | Guarda token y página padre. |
| DELETE | `/api/notion/config` | Borra la configuración guardada. |
| GET | `/api/notion/projects` | Lista toggles y páginas hijas de la página padre. |
| POST | `/api/notion/projects` | Crea un proyecto en Notion. |
| GET | `/api/notion/projects/:blockId` | Lee un proyecto desde Notion. |
| PUT | `/api/notion/projects/:blockId` | Guarda un proyecto en Notion. |
| DELETE | `/api/notion/projects/:blockId` | Archiva el bloque del proyecto. |
| GET | `/api/notion/people?pageId=…&refresh=1` | Lee personas y expositores. |
| GET | `/api/notion/image/:blockId` | Proxy de una imagen de Notion. |
| POST | `/api/publish` | Guarda una instantánea publicada. |
| GET | `/api/published/:publicId` | Devuelve una publicación. |
| DELETE | `/api/published/:publicId` | Elimina una publicación local. |

También se sirven `/catalog/...` y `/uploads/...` como archivos estáticos.

## 13.10. Pruebas ejecutadas

En la entrega actual:

```text
npx tsc --noEmit        OK
npx vitest run          OK · 5 archivos · 27 pruebas
npm run build           OK
```

Cobertura automatizada:

- Geometría: área, centro, límites, autointersecciones, longitudes, puntos dentro del polígono y snap (8 pruebas).
- Esquema de proyecto: validación, normalización y expositores manuales (5 pruebas).
- Cámaras de expositor: colocación interior a 3,5 m, separación de muros, plantas estrechas y marcadores fuera del recinto (11 pruebas).
- Materiales GLB: restauración de valores originales por instancia (2 pruebas).
- Sincronización de Notion: actualización, altas, ausencias y conservación de expositores manuales (1 prueba).

Verificación manual en navegador:

- Inicio → crear proyecto → planta en T → vista 3D.
- La planta en T dio 68 m², 8 vértices y 42 m de perímetro; la vista superior mostró correctamente la concavidad.
- Catálogo dinámico con un GLB de prueba: aparición automática, miniatura, carga en escena, inspector de materiales y restauración de rugosidad.
- Publicación y visor público de la planta en T.
- Cámara sugerida de expositor: quedó dentro del recinto, a 3,5 m y sin atravesar muros; el visor público la aplicó al seleccionar la ficha.
- Servidor de producción local (`npm start` en otro puerto): SPA fallback, API, publicación temporal y visor público.
- Sin excepciones de ejecución en la última prueba del visor.

El GLB de prueba y las publicaciones de prueba se eliminaron antes de cerrar la entrega.

## 13.11. Limitaciones y trabajo pendiente

- **Modelos reales:** no se han recibido los GLB definitivos. Hay que probar escala, orientación, materiales, texturas y rendimiento con ellos.
- **Notion real:** falta configurar token y página y probar guardado, lectura, personas, imágenes y borrado contra la API real.
- **GLTF externo:** la subida de un solo archivo no incluye `.bin` ni texturas; para esos casos hay que copiar la carpeta completa a `public/catalog`.
- **Autenticación:** no existe. Cualquier persona con acceso al servidor puede usar las rutas de escritura. No publicar en internet sin protegerlo.
- **Multiusuario:** no hay cuentas, bloqueo de edición ni resolución de conflictos. Cada navegador tiene sus proyectos locales.
- **Nube:** no hay base de datos remota ni almacenamiento S3/Supabase. Notion es el único almacenamiento remoto opcional.
- **Muros:** no hay ingleteado, puertas, ventanas, curvas ni muros compuestos.
- **Navegación pública:** es orbital; no hay primera persona ni colisiones.
- **Animaciones GLB:** no se reproducen.
- **Rendimiento:** no se han hecho pruebas sistemáticas en móviles de gama baja ni con escenas grandes. Las sombras y el número de luces deben limitarse.
- **Accesibilidad:** hay etiquetas y foco básico, pero no se ha auditado con lector de pantalla.
- **Importación CSV:** no implementada; las personas se importan desde Notion.
- **Copia de seguridad:** no hay backup automático del servidor. Exportar los proyectos y respaldar `data/` y `public/catalog/`.
- **Notion JSON:** límite de ~190 000 caracteres por bloque.
- **Publicación y GLB:** la instantánea no incluye los archivos del catálogo; un cambio o borrado de GLB afecta a las publicaciones existentes.

## 13.12. Dónde colocar los modelos definitivos

Cuando estén disponibles los modelos reales, copiarlos así:

```text
public/catalog/
  mesas/
    mesa-redonda.glb
  sillas/
    silla-negra.glb
  paneles/
    panel-expositivo.glb
```

Después:

1. Abrir o recargar el editor.
2. Ir al panel **Catálogo**.
3. Pulsar el botón de recarga.
4. Arrastrar un modelo a la escena o seleccionarlo y hacer clic en la planta.

Si se despliega solo la carpeta `dist/`, los modelos deben estar en `dist/catalog/` (Vite copia `public/` al compilar) o mantenerse `public/catalog/` junto al servidor. Para añadir modelos después de compilar sin recompilar, conservar `public/catalog/` en el servidor; `resolveCatalogDir()` prioriza esa carpeta.

No hace falta renombrar los archivos para que aparezcan: el nombre del archivo, sin extensión, es el nombre visible. Solo conviene usar nombres claros y sin caracteres problemáticos.
