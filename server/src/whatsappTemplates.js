// WhatsApp template registry for respond.io.
// Add a template here after it is approved in respond.io (name must match EXACTLY, lowercase).
// `language` must match the template's language exactly (e.g. "en_US").
// Variable order for each template is documented beside it.
module.exports = {
  // {{1}} name, {{2}} amount, {{3}} role (receiver/payer), {{4}} signing link
  settlement:           { name: "settlement_signature", language: "en_US" },
  // {{1}} candidate name, {{2}} position, {{3}} date, {{4}} time
  interviewCandidate:   { name: "interview_candidate",   language: "en_US" },
  // {{1}} candidate name, {{2}} position, {{3}} booking link
  interviewBooking:     { name: "interview_booking",     language: "en_US" },
  // {{1}} interviewer name, {{2}} candidate name, {{3}} position, {{4}} date, {{5}} time
  interviewInterviewer: { name: "interview_interviewer", language: "en_US" },
  // {{1}} candidate name, {{2}} position, {{3}} start date, {{4}} number of days
  trialCandidate:       { name: "trial_candidate",       language: "en_US" },
  // {{1}} candidate name, {{2}} position, {{3}} monthly salary (AED), {{4}} start date
  offerCandidate:       { name: "offer_candidate",       language: "en_US" },
  // {{1}} candidate name, {{2}} sizes form link
  uniformSizes:         { name: "uniform_sizes",         language: "en_US" },
  // {{1}} candidate name, {{2}} sizes/info form link
  documentsCollection:  { name: "documents_collection",  language: "en_US" },
  // {{1}} candidate name, {{2}} position   (sent to the manager/HR when the candidate submits the form)
  collectionSubmitted:  { name: "collection_submitted",  language: "en_US" },
  // {{1}} candidate name, {{2}} position   (sent to the manager)
  medicalTawjeeh:       { name: "medical_tawjeeh",       language: "en_US" },
  // {{1}} employee name, {{2}} position    (sent to the procurement manager)
  procurementOrder:     { name: "procurement_order",     language: "en_US" },
  // {{1}} assignee name, {{2}} training level, {{3}} employee name, {{4}} position
  trainingAssignment:   { name: "training_assignment",   language: "en_US" },
  // {{1}} employee name, {{2}} month, {{3}} base, {{4}} itemized additions, {{5}} itemized deductions, {{6}} net
  salaryBreakdown:      { name: "salary_breakdown",      language: "en_US" },
  // {{1}} employee name, {{2}} month, {{3}} payslip link
  payslipLink:          { name: "payslip",               language: "en_US" },
  // {{1}} candidate name, {{2}} position
  rejectedCandidate:    { name: "candidate_rejected",    language: "en_US" },
};
