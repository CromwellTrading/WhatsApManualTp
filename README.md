# Bot de Recargas para WhatsApp

Bot automatizado para gestionar ventas de recargas de videojuegos a través de WhatsApp. Desarrollado con Node.js, Baileys y Supabase.

## Características

- Menú interactivo para clientes con selección de juegos, ofertas y métodos de pago.
- Envío de capturas de pantalla y gestión de solicitudes.
- Panel de administración con comandos para crear/editar/eliminar juegos, ofertas y métodos de pago.
- Persistencia de datos en Supabase.
- Despliegue con Docker.

## Requisitos

- Node.js 18+
- Cuenta en Supabase (base de datos y storage)
- Número de WhatsApp para el bot (secundario)

## Instalación

1. Clonar el repositorio.
2. Ejecutar `npm install`.
3. Crear archivo `.env` basado en `.env.example`.
4. Ejecutar el script SQL `supabase_schema.sql` en el editor SQL de Supabase.
5. Crear un bucket público llamado `recargas` en Supabase Storage.
6. Iniciar el bot con `npm start`.
7. Escanear el código QR en `http://localhost:3000/qr`.

## Comandos de administrador

- `/crear tarjeta` - Agregar una nueva tarjeta de pago.
- `/crear saldo` - Agregar un nuevo número de saldo móvil.
- `/crear tabla` - Crear múltiples juegos desde una lista.
- `/añadir juego a #` - Agregar ofertas a un juego existente.
- `/editar juego #` - Cambiar el nombre de un juego.
- `/editar oferta #juego #oferta` - Modificar una oferta.
- `/editar tarjeta #` - Modificar una tarjeta.
- `/editar saldo #` - Modificar un saldo móvil.
- `/listar juegos` - Ver todos los juegos.
- `/listar ofertas #` - Ver ofertas de un juego.
- `/listar metodos` - Ver todos los métodos de pago.
- `/borrar juego #` - Eliminar un juego y sus ofertas.
- `/borrar oferta #juego #oferta` - Eliminar una oferta.
- `/borrar tarjeta #` - Eliminar una tarjeta.
- `/borrar saldo #` - Eliminar un saldo móvil.
- `/completar ID` - Marcar una solicitud como completada.
- `/cancelar` - Cancelar el diálogo actual.

## Licencia

MIT
