# CONECTA HEX — videojuego web

Adaptación digital del juego de mesa original de Digitalización UD1: `../conecta_hex_v1/Reglamento_v1.md`. Usa el tablero de 19 hexágonos y las 36 preguntas originales; `generate_data.py` recrea `data.js` a partir de los JSON aprobados sin modificarlos.

## Uso

Abre `index.html` en un navegador actual (PC, tableta o móvil), sin cuenta ni conexión. Se puede jugar a tres o cuatro empresas con personas en el mismo dispositivo y rivales automáticos para completar la mesa. Cada navegador conserva su partida de forma local; no se sincroniza entre dispositivos.

Para compartir con el alumnado, entrega el paquete comprimido completo. Deben extraerlo antes de abrir `index.html` para que los scripts y estilos se carguen desde la misma carpeta. El juego no envía respuestas ni datos a un servidor y no da una nota académica.

## Alcance de esta primera versión

Partida local por turnos; partidas individuales con rivales automáticos; producción, mercado, expansión, proyectos, retos y puntuación. **Reglas digitales modificadas:** no se entrega recurso gratuito al empezar un turno (se conserva la producción por dados y la acción de reunir). Se cierra la ronda al alcanzar 18 puntos con proyectos P, T y C; si nadie llega, la partida termina al completar 10 rondas. Los dados se resuelven por orden, los centros del recurso sorteado producen una unidad cada uno por tirada, y los recursos tienen un máximo de 9 por tipo: el excedente de la producción se pierde, pero un intercambio que no se pueda cobrar íntegro se rechaza. El panel indica a qué empresa pertenecen los recursos mostrados y registra los últimos cambios. Una partida guardada de la versión anterior se puede continuar: si estaba en la fase de impulso pasa directamente al mercado; los recursos ya obtenidos no se retiran. No implementa salas en línea ni partidas simultáneas desde dispositivos distintos. Las pruebas automatizadas comprueban las reglas; falta una prueba docente con alumnado para valorar duración, comprensión y diversión.

## Desarrollo y verificación

```
python generate_data.py
node --test tests/engine.test.js
python -m http.server 8080 --bind 127.0.0.1
```

Abre `http://127.0.0.1:8080/` para la prueba local. Si cambian los materiales didácticos, revisa primero los JSON originales y regenera los datos, sin editar las respuestas en el navegador. El fichero JavaScript incluye soluciones para corregir automáticamente: es material de repaso, no un examen seguro.
