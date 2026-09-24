module.exports = {
    recurring: require('./recurring').recurring,
    // REC-003-T02 -- upcoming-occurrence projection.
    getUpcoming: require('./upcoming').getUpcoming,
    // REC-002-T02 -- read-only list/detail views over recurring definitions.
    listRecurring: require('./list').listRecurring,
    getRecurringDetail: require('./list').getRecurringDetail,
    // REC-002-T02/T04 -- lifecycle mutations (pause/resume/end/edit), all CAS-guarded.
    pauseRecurring: require('./lifecycle').pauseRecurring,
    resumeRecurring: require('./lifecycle').resumeRecurring,
    endRecurring: require('./lifecycle').endRecurring,
    editRecurring: require('./lifecycle').editRecurring,
}
