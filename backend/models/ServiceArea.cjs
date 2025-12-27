require('dotenv').config();
const mongoose = require("mongoose");


const serviceAreaSchema = new mongoose.Schema({
    city: {
        type: String,
        required: true
    },
    state: {
        type: String,
        required: true
    },
    coordinates: {
        type: [[Number]],
        required: true
    },
    last_update: {
        type: String,
        required: true,
    },
    is_active: {
        type: Boolean,
        required: true,
    }
});
module.exports = mongoose.model('ServiceArea', serviceAreaSchema);