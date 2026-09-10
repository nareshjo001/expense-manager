module.exports = {
    recurring: require('./recurring').recurring,
    // REC-003-T02 -- upcoming-occurrence projection.
    getUpcoming: require('./upcoming').getUpcoming
}
