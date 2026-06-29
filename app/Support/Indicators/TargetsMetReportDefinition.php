<?php

namespace App\Support\Indicators;

final class TargetsMetReportDefinition
{
    public const SCHOOL_ACHIEVEMENTS_SCOPE = GroupBWorkspaceDefinition::SCHOOL_ACHIEVEMENTS;

    public const KEY_PERFORMANCE_SCOPE = GroupBWorkspaceDefinition::KEY_PERFORMANCE;

    /**
     * @var list<array{key:string,code:string,label:string,aliases?:list<string>}>
     */
    private const SCHOOL_ACHIEVEMENT_ROWS = [
        ['key' => 'school_head_name', 'code' => 'IMETA_HEAD_NAME', 'label' => 'NAME OF SCHOOL HEAD', 'aliases' => ['SALO']],
        ['key' => 'total_enrolment', 'code' => 'IMETA_ENROLL_TOTAL', 'label' => 'TOTAL NUMBER OF ENROLMENT'],
        ['key' => 'sbm_level_of_practice', 'code' => 'IMETA_SBM_LEVEL', 'label' => 'SBM LEVEL OF PRACTICE'],
        ['key' => 'classroom_ratio_kindergarten', 'code' => 'PCR_K', 'label' => 'Pupil/Student Classroom Ratio (Kindergarten)'],
        ['key' => 'classroom_ratio_grades_1_3', 'code' => 'PCR_G1_3', 'label' => 'Pupil/Student Classroom Ratio (Grades 1 to 3)'],
        ['key' => 'classroom_ratio_grades_4_6', 'code' => 'PCR_G4_6', 'label' => 'Pupil/Student Classroom Ratio (Grades 4 to 6)'],
        ['key' => 'classroom_ratio_grades_7_10', 'code' => 'PCR_G7_10', 'label' => 'Pupil/Student Classroom Ratio (Grades 7 to 10)'],
        ['key' => 'classroom_ratio_grades_11_12', 'code' => 'PCR_G11_12', 'label' => 'Pupil/Student Classroom Ratio (Grades 11 to 12)'],
        ['key' => 'water_sanitation_ratio', 'code' => 'WASH_RATIO', 'label' => 'Water and Sanitation facility to pupil ratio'],
        ['key' => 'comfort_rooms', 'code' => 'COMFORT_ROOMS', 'label' => 'Number of Comfort rooms'],
        ['key' => 'comfort_rooms_toilet_bowl', 'code' => 'TOILET_BOWLS', 'label' => 'a. Toilet bowl'],
        ['key' => 'comfort_rooms_urinal', 'code' => 'URINALS', 'label' => 'b. Urinal'],
        ['key' => 'handwashing_facilities', 'code' => 'HANDWASH_FAC', 'label' => 'Handwashing Facilities'],
        ['key' => 'learning_material_ratio', 'code' => 'LEARNING_MAT_RATIO', 'label' => 'Ideal learning materials to learner ratio'],
        ['key' => 'seat_ratio_overall', 'code' => 'PSR_OVERALL', 'label' => 'Pupil/student seat ratio (Overall)'],
        ['key' => 'seat_ratio_kindergarten', 'code' => 'PSR_K', 'label' => 'a. Kindergarten'],
        ['key' => 'seat_ratio_grades_1_6', 'code' => 'PSR_G1_6', 'label' => 'b. Grades 1 - 6'],
        ['key' => 'seat_ratio_grades_7_10', 'code' => 'PSR_G7_10', 'label' => 'c. Grades 7 - 10'],
        ['key' => 'seat_ratio_grades_11_12', 'code' => 'PSR_G11_12', 'label' => 'd. Grades 11 - 12'],
        ['key' => 'ict_package_ratio', 'code' => 'ICT_RATIO', 'label' => 'ICT Package/E-classroom package to sections ratio'],
        ['key' => 'ict_laboratory', 'code' => 'ICT_LAB', 'label' => 'a. ICT Laboratory'],
        ['key' => 'science_laboratory', 'code' => 'SCIENCE_LAB', 'label' => 'Science Laboratory'],
        ['key' => 'internet_access', 'code' => 'INTERNET_ACCESS', 'label' => 'Do you have internet access? (Y/N)'],
        ['key' => 'electricity_access', 'code' => 'ELECTRICITY', 'label' => 'Do you have electricity (Y/N)'],
        ['key' => 'complete_fence_gate', 'code' => 'FENCE_STATUS', 'label' => 'Do you have a complete fence/gate? (Evident/Partially/Not Evident)'],
        ['key' => 'teachers_total', 'code' => 'TEACHERS_TOTAL', 'label' => 'No. of Teachers'],
        ['key' => 'teachers_male', 'code' => 'TEACHERS_MALE', 'label' => 'a. Male'],
        ['key' => 'teachers_female', 'code' => 'TEACHERS_FEMALE', 'label' => 'b. Female'],
        ['key' => 'teachers_with_disability', 'code' => 'TEACHERS_PWD_TOTAL', 'label' => 'Teachers with Physical Disability'],
        ['key' => 'teachers_with_disability_male', 'code' => 'TEACHERS_PWD_MALE', 'label' => 'a. Male'],
        ['key' => 'teachers_with_disability_female', 'code' => 'TEACHERS_PWD_FEMALE', 'label' => 'b. Female'],
        ['key' => 'functional_sgc', 'code' => 'FUNCTIONAL_SGC', 'label' => 'Functional SGC'],
        ['key' => 'feeding_program_beneficiaries', 'code' => 'FEEDING_BENEFICIARIES', 'label' => 'School-Based Feeding Program Beneficiaries'],
        ['key' => 'canteen_income', 'code' => 'CANTEEN_INCOME', 'label' => 'School-Managed Canteen (Annual income)'],
        ['key' => 'teachers_coop_canteen_income', 'code' => 'TEACHER_COOP_INCOME', 'label' => 'Teachers Cooperative Managed Canteen - if there is (Annual income)'],
        ['key' => 'security_safety_plan', 'code' => 'SAFETY_PLAN', 'label' => 'Security and Safety (Contingency Plan)'],
        ['key' => 'security_safety_earthquake', 'code' => 'SAFETY_EARTHQUAKE', 'label' => 'a. Earthquake'],
        ['key' => 'security_safety_typhoon', 'code' => 'SAFETY_TYPHOON', 'label' => 'b. Typhoon'],
        ['key' => 'security_safety_covid', 'code' => 'SAFETY_COVID', 'label' => 'c. COVID-19'],
        ['key' => 'security_safety_power_interruption', 'code' => 'SAFETY_POWER', 'label' => 'd. Power interruption'],
        ['key' => 'security_safety_in_person', 'code' => 'SAFETY_IN_PERSON', 'label' => 'e. In-person classes'],
        ['key' => 'teachers_trained_pfa', 'code' => 'TEACHERS_PFA', 'label' => 'No. of Teachers trained on Psychological First Aid (PFA)'],
        ['key' => 'teachers_trained_occ_first_aid', 'code' => 'TEACHERS_OCC_FIRST_AID', 'label' => 'No. of Teachers trained on Occupational First Aid'],
    ];

    /**
     * @var list<array{key:string,code:string,label:string,aliases?:list<string>}>
     */
    private const KPI_ROWS = [
        ['key' => 'net_enrollment_rate', 'code' => 'NER', 'label' => 'Net Enrollment Rate (NER)'],
        ['key' => 'retention_rate', 'code' => 'RR', 'label' => 'Retention Rate (RR)'],
        ['key' => 'dropout_rate', 'code' => 'DR', 'label' => 'Drop-out Rate (DR)'],
        ['key' => 'transition_rate', 'code' => 'TR', 'label' => 'Transition Rate (TR)'],
        ['key' => 'net_intake_rate', 'code' => 'NIR', 'label' => 'Net Intake Rate (NIR)'],
        ['key' => 'participation_rate', 'code' => 'PR', 'label' => 'Participation Rate (PR)'],
        ['key' => 'als_completion_rate', 'code' => 'ALS_COMPLETER_PCT', 'label' => 'ALS Completion Rate'],
        ['key' => 'gender_parity_index', 'code' => 'GPI', 'label' => 'Gender Parity Index (GPI)'],
        ['key' => 'interquartile_ratio', 'code' => 'IQR', 'label' => 'Interquartile Ratio (IQR)'],
        ['key' => 'completion_rate', 'code' => 'CR', 'label' => 'Completion Rate (CR)'],
        ['key' => 'cohort_survival_rate', 'code' => 'CSR', 'label' => 'Cohort Survival Rate (CSR)'],
        ['key' => 'learning_mastery_nearly_proficient', 'code' => 'PLM_NEARLY_PROF', 'label' => 'Learning Mastery: Nearly Proficient'],
        ['key' => 'learning_mastery_proficient', 'code' => 'PLM_PROF', 'label' => 'Learning Mastery: Proficient'],
        ['key' => 'learning_mastery_highly_proficient', 'code' => 'PLM_HIGH_PROF', 'label' => 'Learning Mastery: Highly Proficient'],
        ['key' => 'ae_test_pass_rate', 'code' => 'AE_PASS_RATE', 'label' => 'A&E Test Pass Rate'],
        ['key' => 'learners_reporting_school_violence', 'code' => 'VIOLENCE_REPORT_RATE', 'label' => 'Learners Reporting School Violence'],
        ['key' => 'learner_satisfaction', 'code' => 'LEARNER_SATISFACTION', 'label' => 'Learner Satisfaction'],
        ['key' => 'learners_aware_of_education_rights', 'code' => 'RIGHTS_AWARENESS', 'label' => 'Learners Aware of Education Rights'],
        ['key' => 'schools_manifesting_rbe_indicators', 'code' => 'RBE_MANIFEST', 'label' => 'Schools/LCs Manifesting RBE Indicators'],
    ];

    /**
     * @return list<array{key:string,code:string,label:string,aliases?:list<string>}>
     */
    public function schoolAchievementRows(): array
    {
        return self::SCHOOL_ACHIEVEMENT_ROWS;
    }

    /**
     * @return list<array{key:string,code:string,label:string,aliases?:list<string>}>
     */
    public function kpiRows(): array
    {
        return self::KPI_ROWS;
    }
}
