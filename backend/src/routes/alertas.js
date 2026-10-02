const router = require('express').Router();
const { resumenAlertas } = require('../servicios/alertas');

router.get('/', async (req, res) => res.json(await resumenAlertas(req.usuario)));

module.exports = router;
