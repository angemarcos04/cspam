<?php

return [
    'max_upload_kb' => (int) env('CSPAMS_FM_QAD_TEMPLATE_MAX_KB', 10240),
    'legacy_directory' => base_path('frontend/public/templates/fm-qad'),
    'forms' => [
        ['scope_id' => 'fm_qad_001', 'code' => 'FM-QAD-001', 'name' => 'Qualitative Evaluation Processing Sheet for Establishment of Private School', 'filename' => 'FM-QAD-001-Qualitative-Evaluation-Processing-Sheet-for-Establishment-of-Private-School.docx'],
        ['scope_id' => 'fm_qad_002', 'code' => 'FM-QAD-002', 'name' => 'Qualitative Evaluation Processing Sheet for Recognition of Private Schools', 'filename' => 'FM-QAD-002-Qualitative-Evaluation-Processing-Sheet-for-Recognition-of-Private-Schools-Copy.docx'],
        ['scope_id' => 'fm_qad_003', 'code' => 'FM-QAD-003', 'name' => 'Qualitative Evaluation Processing Sheet for Renewal Permit and Government Recognition', 'filename' => 'FM-QAD-003-Qualitative-Evaluation-Processing-Sheet-for-Renewal-Permit-to-open-grd-level-Rev-02.docx', 'revision_label' => 'Rev. 02'],
        ['scope_id' => 'fm_qad_004', 'code' => 'FM-QAD-004', 'name' => 'Qualitative Evaluation Processing Sheet for Senior High School', 'filename' => 'FM-QAD-004-Qualitative-Evaluation-Processing-Sheet-for-SHS.docx'],
        ['scope_id' => 'fm_qad_008', 'code' => 'FM-QAD-008', 'name' => 'Checklist for Application for SPED', 'filename' => 'FM-QAD-008-Checklist-for-Application-for-SPED.docx'],
        ['scope_id' => 'fm_qad_009', 'code' => 'FM-QAD-009', 'name' => 'Checklist for Application for the Issuance of Special Order', 'filename' => 'FM-QAD-009-Checklist-for-Application-for-the-Issuance-of-Special-Order.docx'],
        ['scope_id' => 'fm_qad_010', 'code' => 'FM-QAD-010', 'name' => 'Checklist for Application for Tuition Fee Increase', 'filename' => 'FM-QAD-010-Checklist-for-Application-for-Tuition-Fee-Increase.docx'],
        ['scope_id' => 'fm_qad_011', 'code' => 'FM-QAD-011', 'name' => 'Processing Sheet for Application for Additional Strand in Senior High School', 'filename' => 'FM-QAD-011-Processing-Sheet-for-Application-for-Additional-Stand-in-SHS.docx'],
        ['scope_id' => 'fm_qad_034', 'code' => 'FM-QAD-034', 'name' => 'Requirements for the Opening of Science Class', 'filename' => 'FM-QAD-034-Requirements-for-the-Opening-of-Science-Class.docx'],
        ['scope_id' => 'fm_qad_041', 'code' => 'FM-QAD-041', 'name' => 'Request for Confirmation of School Fees', 'filename' => 'FM-QAD-041-Request-for-Confirmation-of-Sch-Fees.docx'],
    ],
];
