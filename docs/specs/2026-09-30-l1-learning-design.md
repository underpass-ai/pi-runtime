# L1: aprendizaje continuo de Pi Runtime

- **Fecha:** 2026-09-30
- **Estado:** aprobada por Tirso, sección a sección
- **Depende de:**
  - E1 (log de eventos): `docs/specs/2026-09-29-e1-event-log-design.md`
  - O1 (observabilidad): `docs/specs/2026-09-29-o1-observability-design.md`
- **Modelo:** el bandit de underpass-runtime, con dos correcciones:
  - en el runtime, las negativas de gobierno contaban como fallo;
  - en el runtime, el modo shadow seguía reordenando.

## 0. Decisiones

1. **Qué decide.** L1 decide qué tools de KMP y MADE están activas para el modelo en cada contexto.
2. **Cómo entra en producción.** Primero en un modo *shadow* real, que registra lo que habría elegido y no toca nada. Pasa a *active* con un cambio explícito, siempre dentro de lo que la fase permite y con un mínimo fijo.
3. **Recompensa.** Uso útil más éxito:
   - las negativas y los abortos no cuentan;
   - no usar una tool expuesta es un 0 suave.
4. **Todo desde el log.** Decisiones, modo y estado del bandit son hechos y proyecciones de E1: se pueden reconstruir y reproducir.

## 1. Decisión

- **Cuándo:** en `agent_start` (una por cada petición del usuario, no por cada llamada al LLM) y en cada cambio de fase.
- **Candidatas:** las tools de KMP y MADE que la fase actual permite según S1. Los verbos de control de MADE nunca están entre ellas.
- **Mínimo fijo:** `kmp_wake`, `kmp_ask` y las tools de estado de MADE que la fase permita (`made_get_status`, `made_discover_capabilities`). Siempre están activas y no participan en el bandit.
- **Tools de Pi:** bash, read, edit y el resto no se tocan nunca.
- **Tamaño:** se exponen el mínimo fijo más las `k` mejores candidatas muestreadas. `k` es configurable y vale 12 por defecto; si hay menos de `k` candidatas, se exponen todas.
- **Contexto:** el par `(fase, proyecto)`, donde el proyecto es el id HMAC de O1. No se usa el texto del prompt, que E1 no guarda.

## 2. Algoritmo

- **Modelo:** Thompson Sampling con una Beta(α, β) por `(contexto, tool)`.
- **Prior:**
  - neutral Beta(1, 1) para las candidatas;
  - las tools que ya tienen éxitos registrados en `tool_stats` para ese proyecto arrancan con α incrementado en `min(éxitos, 5)`, de forma análoga al impulso por telemetría del runtime.
- **No estacionariedad:** Beta-SWTS con ventana deslizante de las últimas 200 observaciones por `(contexto, tool)`. Las más antiguas se descartan.
- **Muestreo:**
  - determinista, con un PRNG sembrado con el `event_id` de `tools.selected`;
  - se ordena por el valor muestreado y se toman las `k` primeras;
  - los empates se resuelven por nombre.
- **Fuera de alcance:** HyLinUCB y NeuralTS. En el runtime perdían el estado al reiniciar y entrenaban y servían con features distintas.

## 3. Recompensa

Por cada tool candidata expuesta dentro de la ventana de una decisión:

| Resultado en la ventana | Recompensa | Peso |
|---|---|---|
| Usada y `succeeded` en su primera invocación | 1 | 1 |
| Usada y `failed` en su primera invocación | 0 | 1 |
| Primera invocación `refused` o `aborted` | no cuenta | — |
| Expuesta y no usada | 0 | 0,2 |

- **Actualización:** una observación de peso `w` suma `w·r` a α y `w·(1−r)` a β.
- **Ventana:** desde un `tools.selected` hasta el siguiente de la misma sesión, o hasta el cierre o el abandono de la sesión.
- **Cuándo cuenta el 0 suave:** sólo si la ventana tuvo actividad del modelo, es decir, al menos un turno completado o una llamada a tool; una ventana sin actividad no dice nada de las tools expuestas.
- **Candidatas no expuestas:** no reciben recompensa, porque no se observan.
- **Decisiones que no cuentan:** las del grupo de control y las del modo shadow no actualizan las recompensas de «expuesta y no usada». Con el conjunto completo, todas las tools estaban expuestas. Las tools usadas sí actualizan con peso 1, porque son observaciones reales de utilidad.

## 4. Modos y grupo de control

- **`off`:** L1 desactivado. No hay selección ni hechos.
- **`shadow`** (modo por defecto):
  - se calcula y se registra la selección, pero el modelo sigue con el conjunto completo de la fase;
  - la evaluación offline compara la selección con lo que el modelo usó de verdad.
- **`active`:** se aplica `setActiveTools` con el mínimo, el top-k y las tools de Pi.
- **Grupo de control en `active`:** el 10 % de las decisiones mantiene el conjunto completo. Qué decisión es de control se deriva de forma determinista del `event_id` y queda registrado en el hecho.
- **Cambio de modo:**
  - se registra como hecho `learning.mode_changed` en el stream `host`, con `{from, to, k}` y actor `human`;
  - la proyección respeta el modo vigente en cada momento.
- **Modo `fallback`:** si el host no puede decidir, devuelve el conjunto completo y registra `mode=fallback`.

## 5. Hechos nuevos (type_version 1)

- `tools.selected`, en el stream de la sesión. El payload lleva solo nombres de tools, que son públicos del catálogo, y ningún contenido:
  - `{context: {phase, project}, mode: shadow|active|fallback, control: bool, k, candidates: [..], selected: [..], floor: [..], seed}`.
- `learning.mode_changed`, en el stream `host`:
  - `{from, to, k}`.

Estos hechos se añaden a la lista de pares `(type, type_version)` que acepta `FactMapper`, y a `SessionAggregate` y `SpanAssembler`. En este último, `tools.selected` se convierte en un evento del span de sesión.

## 6. Proyecciones

- **`tool_bandit`:**
  - estado Beta con ventana por `(contexto, tool)`;
  - decisiones abiertas por sesión, a la espera de recompensa;
  - modo vigente y `k`.
- **`learning_eval`:**
  - **Shadow:** miss rate, es decir, la proporción de tools usadas que la selección habría dejado fuera. También el ahorro medio en número de tools y en bytes de esquema, estimado con los tamaños de catálogo.
  - **Active:** éxito a la primera, turnos por petición y tasa de negativas, comparando el grupo tratado con el de control.
- **Reconstrucción:** ambas se reconstruyen con `underpass events rebuild <nombre>`.

## 7. IPC y extensión

- **Método nuevo `select`:**
  - petición `{sessionId, phase}`;
  - respuesta `{mode, control, selected: string[], floor: string[]}`;
  - el host muestrea, registra `tools.selected` y responde.
- **Extensión:** llama a `select` en `agent_start` y en `PHASE_CHANGED`, con un tiempo máximo de 200 ms.
  - En `active` sin control, aplica `setActiveTools(floor ∪ selected ∪ tools de Pi)`.
  - En cualquier otro caso, no toca nada.
- **Si el host no responde:** timeout, error u host caído dejan el conjunto completo sin registrar nada, y Pi nunca espera más de 200 ms.

## 8. Superficies

- **`underpass learning report [--context <fase>]`:** muestra por contexto:
  - las tools con media, α/β y n;
  - la evaluación: miss rate y ahorro en shadow, tratado frente a control en active.
- **`underpass learning mode shadow|active|off [--k N]`:** registra el hecho; `k` debe estar entre 4 y 64.
- **`/underpass-status`:** `learning: <modo> · <expuestas>/<candidatas> tools · miss <x %>`.
- **`doctor`, sección `[learning]`:**
  - `OK` en off y en shadow;
  - `WARN` si la proyección va atrasada;
  - `WARN` en active si el éxito a la primera del control supera al del tratado en más de 5 puntos con n ≥ 50 en cada grupo, con el remedio `underpass learning mode shadow`.

## 9. Errores

- La selección nunca bloquea Pi ni reduce la fase por debajo del mínimo fijo.
- Las tools nuevas del catálogo entran con el prior neutral, y las que desaparecen se ignoran en la selección y en el informe.
- Las proyecciones toleran payloads inesperados, igual que las de O1.

## 10. Pruebas y aceptación

- **Unitarias:**
  - Thompson con semilla fija y ventana deslizante;
  - reglas de recompensa (negativas y abortos, 0 suave, control y shadow);
  - la selección nunca sale de la fase y siempre incluye el mínimo;
  - control determinista;
  - proyecciones iguales en modo incremental y reconstruidas.
- **Simulación offline:** un entorno sintético con tools útiles e inútiles por contexto.
  - Tras 300 decisiones, el miss rate debe ser menor del 10 % y el ahorro mayor del 50 %.
  - Cuando cambia la utilidad, debe adaptarse en menos de 200 decisiones.
- **Integración:**
  - IPC `select` con host real;
  - `setActiveTools` aplicado solo en `active` sin control;
  - con el host caído, el conjunto completo y ningún hecho;
  - un timeout de 200 ms respetado.
- **Aceptación en la instalación real:**
  - sesiones en kmp en modo shadow e informe con cifras;
  - cambio a `active` con el grupo de control visible en el informe;
  - `doctor` en verde y vuelta a `shadow`.

## 11. Fuera de alcance

- Contexto por tipo de tarea o texto del prompt.
- Aprender modelo o esfuerzo.
- Recomendaciones en el prompt.
- HyLinUCB y NeuralTS.
- Aprender entre proyectos (cada proyecto aprende por separado).
