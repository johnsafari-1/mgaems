-- MariaDB dump 10.19  Distrib 10.4.32-MariaDB, for Win64 (AMD64)
--
-- Host: 127.0.0.1    Database: mgaems
-- ------------------------------------------------------
-- Server version	10.4.32-MariaDB

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `academic_years`
--

DROP TABLE IF EXISTS `academic_years`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `academic_years` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(20) NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `is_current` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `academic_years_name_unique` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `academic_years`
--

LOCK TABLES `academic_years` WRITE;
/*!40000 ALTER TABLE `academic_years` DISABLE KEYS */;
INSERT INTO `academic_years` VALUES (1,'2026','2026-01-01','2026-12-31',1);
/*!40000 ALTER TABLE `academic_years` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `announcements`
--

DROP TABLE IF EXISTS `announcements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `announcements` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `published_by` bigint(20) unsigned NOT NULL,
  `title` varchar(200) NOT NULL,
  `body` text NOT NULL,
  `audience` enum('school_wide','class','parents','sponsors','staff') NOT NULL,
  `published_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `announcements_published_by_foreign` (`published_by`),
  KEY `idx_announce_audience` (`audience`),
  CONSTRAINT `announcements_published_by_foreign` FOREIGN KEY (`published_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `announcements`
--

LOCK TABLES `announcements` WRITE;
/*!40000 ALTER TABLE `announcements` DISABLE KEYS */;
INSERT INTO `announcements` VALUES (1,1,'Mid-Term Break Notice','School will close for mid-term break on August 15th and reopen on August 25th.','school_wide','2026-08-03 04:58:51'),(2,1,'Staff Meeting Friday','All staff to attend the 4pm meeting in the staff room.','staff','2026-08-03 05:02:06');
/*!40000 ALTER TABLE `announcements` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `assessments`
--

DROP TABLE IF EXISTS `assessments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `assessments` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `student_id` bigint(20) unsigned NOT NULL,
  `subject_id` bigint(20) unsigned NOT NULL,
  `term_id` bigint(20) unsigned NOT NULL,
  `recorded_by` bigint(20) unsigned NOT NULL,
  `assessment_type` enum('continuous','end_term') NOT NULL,
  `score` decimal(5,2) DEFAULT NULL,
  `competency_rating` varchar(30) DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `recorded_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `assessments_term_id_foreign` (`term_id`),
  KEY `assessments_recorded_by_foreign` (`recorded_by`),
  KEY `idx_assess_student_term` (`student_id`,`term_id`),
  KEY `idx_assess_subject` (`subject_id`),
  CONSTRAINT `assessments_recorded_by_foreign` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `assessments_student_id_foreign` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `assessments_subject_id_foreign` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `assessments_term_id_foreign` FOREIGN KEY (`term_id`) REFERENCES `terms` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `assessments`
--

LOCK TABLES `assessments` WRITE;
/*!40000 ALTER TABLE `assessments` DISABLE KEYS */;
INSERT INTO `assessments` VALUES (1,1,1,1,1,'continuous',78.00,'Meeting Expectation','Good progress with number work.','2026-08-02 13:52:26'),(2,1,1,1,1,'end_term',82.00,'Meeting Expectation','Strong exam performance.','2026-08-02 13:52:55');
/*!40000 ALTER TABLE `assessments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `attendance_students`
--

DROP TABLE IF EXISTS `attendance_students`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `attendance_students` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `student_id` bigint(20) unsigned NOT NULL,
  `class_id` bigint(20) unsigned NOT NULL,
  `attendance_date` date NOT NULL,
  `status` enum('present','absent','late','excused') NOT NULL,
  `recorded_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_student_attendance` (`student_id`,`attendance_date`),
  KEY `attendance_students_recorded_by_foreign` (`recorded_by`),
  KEY `idx_attendance_class_date` (`class_id`,`attendance_date`),
  CONSTRAINT `attendance_students_class_id_foreign` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `attendance_students_recorded_by_foreign` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `attendance_students_student_id_foreign` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `attendance_students`
--

LOCK TABLES `attendance_students` WRITE;
/*!40000 ALTER TABLE `attendance_students` DISABLE KEYS */;
INSERT INTO `attendance_students` VALUES (1,1,2,'2026-08-02','present',1,'2026-08-02 13:45:05','2026-08-02 13:45:05');
/*!40000 ALTER TABLE `attendance_students` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `audit_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) unsigned DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `entity_type` varchar(100) DEFAULT NULL,
  `entity_id` bigint(20) unsigned DEFAULT NULL,
  `details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`details`)),
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_audit_user` (`user_id`),
  KEY `idx_audit_entity` (`entity_type`,`entity_id`),
  KEY `idx_audit_created` (`created_at`),
  CONSTRAINT `audit_logs_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=41 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_logs`
--

LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
INSERT INTO `audit_logs` VALUES (1,NULL,'LOGIN_SUCCESS','User',1,NULL,'127.0.0.1','2026-08-01 23:14:33'),(2,NULL,'LOGIN_SUCCESS','User',1,NULL,'127.0.0.1','2026-08-02 08:07:22'),(3,1,'CREATE_CLASS','SchoolClass',1,'{\"name\":\"Grade 1\",\"level\":\"primary\",\"sequence\":1}','127.0.0.1','2026-08-02 08:07:50'),(4,NULL,'LOGIN_SUCCESS','User',1,NULL,'127.0.0.1','2026-08-02 13:01:46'),(5,1,'CREATE_STUDENT','Student',1,'{\"admission_no\":\"MGA-2026-0001\"}','127.0.0.1','2026-08-02 13:02:14'),(6,NULL,'LOGIN_SUCCESS','User',1,NULL,'127.0.0.1','2026-08-02 13:10:56'),(7,1,'CREATE_CLASS','SchoolClass',2,'{\"name\":\"Grade 2\",\"level\":\"primary\",\"sequence\":2}','127.0.0.1','2026-08-02 13:22:08'),(8,1,'PROMOTE_STUDENT','Student',1,'{\"to_class_id\":2,\"term_id\":1,\"reason\":\"End of year promotion\",\"effective_date\":\"2026-12-01\"}','127.0.0.1','2026-08-02 13:25:06'),(9,1,'PROMOTE_STUDENT','Student',1,'{\"to_class_id\":2,\"term_id\":1,\"reason\":\"End of year promotion\",\"effective_date\":\"2026-12-01\"}','127.0.0.1','2026-08-02 13:25:38'),(10,NULL,'LOGIN_SUCCESS','User',1,NULL,'127.0.0.1','2026-08-02 13:44:29'),(11,1,'RECORD_ATTENDANCE','SchoolClass',2,'{\"attendance_date\":\"2026-08-02\",\"count\":1}','127.0.0.1','2026-08-02 13:45:05'),(12,NULL,'LOGIN_SUCCESS','User',1,NULL,'127.0.0.1','2026-08-02 13:51:31'),(13,1,'CREATE_SUBJECT','Subject',1,'{\"name\":\"Mathematics\"}','127.0.0.1','2026-08-02 13:52:00'),(14,1,'RECORD_ASSESSMENT','Assessment',1,'{\"student_id\":1,\"subject_id\":1,\"term_id\":1,\"assessment_type\":\"continuous\",\"score\":78,\"competency_rating\":\"Meeting Expectation\",\"remarks\":\"Good progress with number work.\"}','127.0.0.1','2026-08-02 13:52:26'),(15,1,'RECORD_ASSESSMENT','Assessment',2,'{\"student_id\":1,\"subject_id\":1,\"term_id\":1,\"assessment_type\":\"end_term\",\"score\":82,\"competency_rating\":\"Meeting Expectation\",\"remarks\":\"Strong exam performance.\"}','127.0.0.1','2026-08-02 13:52:55'),(16,1,'GENERATE_REPORT_CARD','ReportCard',1,'{\"student_id\":1,\"term_id\":1}','127.0.0.1','2026-08-02 13:53:37'),(17,NULL,'LOGIN_SUCCESS','User',1,NULL,'127.0.0.1','2026-08-02 18:56:49'),(18,1,'CREATE_SPONSOR','Sponsor',1,'{\"name\":\"Grace Fellowship Church\"}','127.0.0.1','2026-08-02 18:57:20'),(19,1,'CREATE_SPONSORSHIP','Sponsorship',1,'{\"sponsor_id\":1,\"sponsorship_type\":\"individual\",\"student_id\":1,\"start_date\":\"2026-01-15\",\"notes\":\"Full sponsorship for the 2026 academic year.\"}','127.0.0.1','2026-08-02 18:57:48'),(20,1,'CREATE_SPONSOR','Sponsor',2,'{\"name\":\"John Kamau\"}','127.0.0.1','2026-08-02 18:58:39'),(21,NULL,'LOGIN_SUCCESS','User',1,NULL,'127.0.0.1','2026-08-02 19:04:30'),(22,1,'CREATE_USER','User',2,'{\"role\":\"parent_guardian\"}','127.0.0.1','2026-08-02 19:05:19'),(23,NULL,'LOGIN_SUCCESS','User',2,NULL,'127.0.0.1','2026-08-02 19:08:20'),(24,NULL,'LOGIN_SUCCESS','User',2,NULL,'127.0.0.1','2026-08-02 19:11:03'),(25,1,'CREATE_STUDENT','Student',2,'{\"admission_no\":\"MGA-2026-0002\"}','127.0.0.1','2026-08-02 19:12:47'),(26,2,'PORTAL_ACCESS_DENIED','Student',2,'{\"reason\":\"not_own_child\"}','127.0.0.1','2026-08-02 19:13:13'),(27,NULL,'LOGIN_SUCCESS','User',1,NULL,'127.0.0.1','2026-08-02 19:18:59'),(28,NULL,'LOGIN_SUCCESS','User',1,NULL,'127.0.0.1','2026-08-03 04:51:20'),(29,1,'CREATE_STAFF','Staff',1,'{\"name\":\"Samuel Kiptoo\"}','127.0.0.1','2026-08-03 04:52:31'),(30,NULL,'LOGIN_SUCCESS','User',1,NULL,'127.0.0.1','2026-08-03 04:58:04'),(31,1,'PUBLISH_ANNOUNCEMENT','Announcement',1,'{\"audience\":\"school_wide\"}','127.0.0.1','2026-08-03 04:58:51'),(32,NULL,'LOGIN_SUCCESS','User',2,NULL,'127.0.0.1','2026-08-03 04:59:43'),(33,1,'PUBLISH_ANNOUNCEMENT','Announcement',2,'{\"audience\":\"staff\"}','127.0.0.1','2026-08-03 05:02:06'),(34,NULL,'LOGIN_SUCCESS','User',1,NULL,'127.0.0.1','2026-08-03 05:18:43'),(35,1,'RECORD_VISITOR','Visitor',1,'{\"visitor_name\":\"Grace Fellowship Church Team\"}','127.0.0.1','2026-08-03 05:19:12'),(36,NULL,'LOGIN_SUCCESS','User',1,NULL,'127.0.0.1','2026-08-03 05:23:41'),(37,1,'VIEW_SCHOOL_STATISTICS',NULL,NULL,NULL,'127.0.0.1','2026-08-03 05:24:04'),(38,1,'EXPORT_STUDENTS_REPORT',NULL,NULL,NULL,'127.0.0.1','2026-08-03 05:24:40'),(39,NULL,'LOGIN_SUCCESS','User',1,NULL,'127.0.0.1','2026-08-03 11:20:51'),(40,1,'BACKUP_FAILED',NULL,NULL,'{\"error\":\"mysqldump.exe: Got error: 2004: \\\"Can\'t create TCP\\/IP socket (10106)\\\" when trying to connect\\r\\n\"}','127.0.0.1','2026-08-03 11:21:24');
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `class_subjects`
--

DROP TABLE IF EXISTS `class_subjects`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `class_subjects` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `class_id` bigint(20) unsigned NOT NULL,
  `subject_id` bigint(20) unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_class_subject` (`class_id`,`subject_id`),
  KEY `class_subjects_subject_id_foreign` (`subject_id`),
  CONSTRAINT `class_subjects_class_id_foreign` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `class_subjects_subject_id_foreign` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `class_subjects`
--

LOCK TABLES `class_subjects` WRITE;
/*!40000 ALTER TABLE `class_subjects` DISABLE KEYS */;
/*!40000 ALTER TABLE `class_subjects` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `classes`
--

DROP TABLE IF EXISTS `classes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `classes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(30) NOT NULL,
  `level` enum('primary','junior') NOT NULL,
  `sequence` tinyint(3) unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `classes_name_unique` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `classes`
--

LOCK TABLES `classes` WRITE;
/*!40000 ALTER TABLE `classes` DISABLE KEYS */;
INSERT INTO `classes` VALUES (1,'Grade 1','primary',1),(2,'Grade 2','primary',2);
/*!40000 ALTER TABLE `classes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `departments`
--

DROP TABLE IF EXISTS `departments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `departments` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(80) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `departments_name_unique` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `departments`
--

LOCK TABLES `departments` WRITE;
/*!40000 ALTER TABLE `departments` DISABLE KEYS */;
/*!40000 ALTER TABLE `departments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `guardians`
--

DROP TABLE IF EXISTS `guardians`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `guardians` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `student_id` bigint(20) unsigned NOT NULL,
  `user_id` bigint(20) unsigned DEFAULT NULL,
  `full_name` varchar(150) NOT NULL,
  `relationship` varchar(30) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `email` varchar(150) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `is_primary_contact` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `guardians_user_id_foreign` (`user_id`),
  KEY `idx_guardians_student` (`student_id`),
  CONSTRAINT `guardians_student_id_foreign` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `guardians_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `guardians`
--

LOCK TABLES `guardians` WRITE;
/*!40000 ALTER TABLE `guardians` DISABLE KEYS */;
INSERT INTO `guardians` VALUES (2,1,2,'Grace Achieng','Mother','0712345678',NULL,NULL,1);
/*!40000 ALTER TABLE `guardians` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `messages`
--

DROP TABLE IF EXISTS `messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `messages` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `sender_id` bigint(20) unsigned NOT NULL,
  `recipient_id` bigint(20) unsigned NOT NULL,
  `body` text NOT NULL,
  `sent_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `read_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_msg_recipient` (`recipient_id`),
  KEY `idx_msg_sender` (`sender_id`),
  CONSTRAINT `messages_recipient_id_foreign` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `messages_sender_id_foreign` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `messages`
--

LOCK TABLES `messages` WRITE;
/*!40000 ALTER TABLE `messages` DISABLE KEYS */;
/*!40000 ALTER TABLE `messages` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `migrations`
--

DROP TABLE IF EXISTS `migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `migrations` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `migration` varchar(255) NOT NULL,
  `batch` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=29 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `migrations`
--

LOCK TABLES `migrations` WRITE;
/*!40000 ALTER TABLE `migrations` DISABLE KEYS */;
INSERT INTO `migrations` VALUES (1,'2019_12_14_000001_create_personal_access_tokens_table',1),(2,'2026_08_01_000001_create_roles_table',1),(3,'2026_08_01_000002_create_users_table',1),(4,'2026_08_01_000003_create_academic_years_table',1),(5,'2026_08_01_000004_create_terms_table',1),(6,'2026_08_01_000005_create_audit_logs_table',1),(7,'2026_08_01_000006_create_password_reset_tokens_table',1),(8,'2026_08_02_000007_create_classes_table',2),(9,'2026_08_02_000008_create_streams_table',2),(10,'2026_08_02_000009_create_subjects_table',2),(11,'2026_08_02_000010_create_class_subjects_table',2),(12,'2026_08_02_000011_create_students_table',3),(13,'2026_08_02_000012_create_guardians_table',3),(14,'2026_08_02_000013_create_student_medical_info_table',3),(15,'2026_08_02_000014_create_promotions_transfers_table',4),(16,'2026_08_02_000015_create_attendance_students_table',5),(17,'2026_08_02_000016_create_assessments_table',6),(18,'2026_08_02_000017_create_report_cards_table',6),(19,'2026_08_02_000018_create_sponsors_table',7),(20,'2026_08_02_000019_create_sponsorships_table',7),(21,'2026_08_02_000020_create_departments_table',8),(22,'2026_08_02_000021_create_staff_table',8),(23,'2026_08_02_000022_create_staff_qualifications_table',8),(24,'2026_08_02_000023_create_staff_documents_table',8),(25,'2026_08_02_000024_create_staff_emergency_contacts_table',8),(26,'2026_08_03_000025_create_announcements_table',9),(27,'2026_08_03_000026_create_messages_table',9),(28,'2026_08_03_000027_create_visitors_table',10);
/*!40000 ALTER TABLE `migrations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `password_reset_tokens`
--

DROP TABLE IF EXISTS `password_reset_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `password_reset_tokens` (
  `email` varchar(150) NOT NULL,
  `token` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `password_reset_tokens`
--

LOCK TABLES `password_reset_tokens` WRITE;
/*!40000 ALTER TABLE `password_reset_tokens` DISABLE KEYS */;
/*!40000 ALTER TABLE `password_reset_tokens` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `personal_access_tokens`
--

DROP TABLE IF EXISTS `personal_access_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `personal_access_tokens` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `tokenable_type` varchar(255) NOT NULL,
  `tokenable_id` bigint(20) unsigned NOT NULL,
  `name` varchar(255) NOT NULL,
  `token` varchar(64) NOT NULL,
  `abilities` text DEFAULT NULL,
  `last_used_at` timestamp NULL DEFAULT NULL,
  `expires_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `personal_access_tokens_token_unique` (`token`),
  KEY `personal_access_tokens_tokenable_type_tokenable_id_index` (`tokenable_type`,`tokenable_id`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `personal_access_tokens`
--

LOCK TABLES `personal_access_tokens` WRITE;
/*!40000 ALTER TABLE `personal_access_tokens` DISABLE KEYS */;
INSERT INTO `personal_access_tokens` VALUES (1,'App\\Models\\User',1,'mgaems-web','55e3f5cf6101844da8d51705d44dae67f856c1cfd8ed61e68c2d9192bbe32096','[\"*\"]','2026-08-01 23:18:27',NULL,'2026-08-01 23:14:33','2026-08-01 23:18:27'),(2,'App\\Models\\User',1,'mgaems-web','3743c7bb9dd9be6dca3728902935983c58ba21bb57d8f3395ddd7007447acac0','[\"*\"]','2026-08-02 08:08:24',NULL,'2026-08-02 08:07:22','2026-08-02 08:08:24'),(3,'App\\Models\\User',1,'mgaems-web','75c7d1932751fbaca7b18880a2fcc7bbdb8482baf8bc8cceef5c3e0f26843369','[\"*\"]','2026-08-02 13:02:13',NULL,'2026-08-02 13:01:46','2026-08-02 13:02:13'),(4,'App\\Models\\User',1,'mgaems-web','31a7903ade0a2ea5792b0d8f5c021410455b7e3bcf947887fe033837ffa9ba21','[\"*\"]','2026-08-02 13:27:03',NULL,'2026-08-02 13:10:56','2026-08-02 13:27:03'),(5,'App\\Models\\User',1,'mgaems-web','eab97f0c378ba7c1f999f9dae5bbfaa588eda5839b28efbd0aeea2efa212dbd0','[\"*\"]','2026-08-02 13:45:30',NULL,'2026-08-02 13:44:29','2026-08-02 13:45:30'),(6,'App\\Models\\User',1,'mgaems-web','18bbf41960d57641d75fe301053243f0f21e6d3ee76a9cf5023fd4ee018968b1','[\"*\"]','2026-08-02 13:56:57',NULL,'2026-08-02 13:51:31','2026-08-02 13:56:57'),(7,'App\\Models\\User',1,'mgaems-web','4a16487c5820de3f0a9f2eea48173a69fc43a36116cac694d73ef27eda75a29f','[\"*\"]','2026-08-02 18:59:10',NULL,'2026-08-02 18:56:49','2026-08-02 18:59:10'),(8,'App\\Models\\User',1,'mgaems-web','f6ec559b7e447beda8f46c72a521e429b077c520e6048b6bd5990d7947814a9e','[\"*\"]','2026-08-02 19:12:47',NULL,'2026-08-02 19:04:30','2026-08-02 19:12:47'),(9,'App\\Models\\User',2,'mgaems-web','198d563a99828a0bbc815d5d595282b6daec35bf1e2503db7c7a645d61b95189','[\"*\"]','2026-08-02 19:08:44',NULL,'2026-08-02 19:08:20','2026-08-02 19:08:44'),(10,'App\\Models\\User',2,'mgaems-web','b695ab9ebbf140b8e319587abfd14b00ceec449a988d58747fb8870269948a39','[\"*\"]','2026-08-02 19:13:13',NULL,'2026-08-02 19:11:03','2026-08-02 19:13:13'),(11,'App\\Models\\User',1,'mgaems-web','05475a2233c8ff5e5df40ca09d1d7594623435fdb0c7541be1dfd33a9d140858','[\"*\"]',NULL,NULL,'2026-08-02 19:18:59','2026-08-02 19:18:59'),(12,'App\\Models\\User',1,'mgaems-web','c39d0f5ea65cfca7b00abaccc4d989e4e3e6ee44056aff3f2af4aacdf9089497','[\"*\"]','2026-08-03 04:52:30',NULL,'2026-08-03 04:51:20','2026-08-03 04:52:30'),(13,'App\\Models\\User',1,'mgaems-web','3db6af76dd1e248968d288269a70271e2bcc4dd4202a643f8adab0f4b45ce4a8','[\"*\"]','2026-08-03 05:02:06',NULL,'2026-08-03 04:58:04','2026-08-03 05:02:06'),(14,'App\\Models\\User',2,'mgaems-web','aa8d8cd952693a9376fd3bf3fc75d5adefbb80d7bfc708a2cf18b4db3bd88ca9','[\"*\"]','2026-08-03 05:02:41',NULL,'2026-08-03 04:59:43','2026-08-03 05:02:41'),(15,'App\\Models\\User',1,'mgaems-web','e8ef8877ae31ead2213ef2d66815e39bfb7feb62e2b1f899da5b38ae7949ecb8','[\"*\"]','2026-08-03 05:19:12',NULL,'2026-08-03 05:18:43','2026-08-03 05:19:12'),(16,'App\\Models\\User',1,'mgaems-web','a618e48b132545e0c952c2e414e1a6036f8f06ec00d22021d037800a074ec0d2','[\"*\"]','2026-08-03 05:24:40',NULL,'2026-08-03 05:23:41','2026-08-03 05:24:40'),(17,'App\\Models\\User',1,'mgaems-web','9e367182c461b419cc2ffd890436518946056ff8c1361265b3f77338f0515574','[\"*\"]','2026-08-03 11:21:23',NULL,'2026-08-03 11:20:51','2026-08-03 11:21:23');
/*!40000 ALTER TABLE `personal_access_tokens` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `promotions_transfers`
--

DROP TABLE IF EXISTS `promotions_transfers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `promotions_transfers` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `student_id` bigint(20) unsigned NOT NULL,
  `type` enum('promotion','transfer_in','transfer_out') NOT NULL,
  `from_class_id` bigint(20) unsigned DEFAULT NULL,
  `to_class_id` bigint(20) unsigned DEFAULT NULL,
  `term_id` bigint(20) unsigned NOT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `effective_date` date NOT NULL,
  `recorded_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `promotions_transfers_from_class_id_foreign` (`from_class_id`),
  KEY `promotions_transfers_to_class_id_foreign` (`to_class_id`),
  KEY `promotions_transfers_term_id_foreign` (`term_id`),
  KEY `promotions_transfers_recorded_by_foreign` (`recorded_by`),
  KEY `idx_promo_student` (`student_id`),
  CONSTRAINT `promotions_transfers_from_class_id_foreign` FOREIGN KEY (`from_class_id`) REFERENCES `classes` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `promotions_transfers_recorded_by_foreign` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `promotions_transfers_student_id_foreign` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `promotions_transfers_term_id_foreign` FOREIGN KEY (`term_id`) REFERENCES `terms` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `promotions_transfers_to_class_id_foreign` FOREIGN KEY (`to_class_id`) REFERENCES `classes` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `promotions_transfers`
--

LOCK TABLES `promotions_transfers` WRITE;
/*!40000 ALTER TABLE `promotions_transfers` DISABLE KEYS */;
INSERT INTO `promotions_transfers` VALUES (1,1,'promotion',1,2,1,'End of year promotion','2026-12-01',1,'2026-08-02 13:25:06'),(2,1,'promotion',2,2,1,'End of year promotion','2026-12-01',1,'2026-08-02 13:25:38');
/*!40000 ALTER TABLE `promotions_transfers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `report_cards`
--

DROP TABLE IF EXISTS `report_cards`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `report_cards` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `student_id` bigint(20) unsigned NOT NULL,
  `term_id` bigint(20) unsigned NOT NULL,
  `overall_remark` text DEFAULT NULL,
  `file_path` varchar(255) DEFAULT NULL,
  `generated_at` timestamp NULL DEFAULT NULL,
  `generated_by` bigint(20) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_report_card` (`student_id`,`term_id`),
  KEY `report_cards_term_id_foreign` (`term_id`),
  KEY `report_cards_generated_by_foreign` (`generated_by`),
  CONSTRAINT `report_cards_generated_by_foreign` FOREIGN KEY (`generated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `report_cards_student_id_foreign` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `report_cards_term_id_foreign` FOREIGN KEY (`term_id`) REFERENCES `terms` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `report_cards`
--

LOCK TABLES `report_cards` WRITE;
/*!40000 ALTER TABLE `report_cards` DISABLE KEYS */;
INSERT INTO `report_cards` VALUES (1,1,1,'Mary has shown consistent effort this term. Keep up the good work.','report-cards/1-1.pdf','2026-08-02 13:53:37',1);
/*!40000 ALTER TABLE `report_cards` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `roles`
--

DROP TABLE IF EXISTS `roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `roles` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `roles_name_unique` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `roles`
--

LOCK TABLES `roles` WRITE;
/*!40000 ALTER TABLE `roles` DISABLE KEYS */;
INSERT INTO `roles` VALUES (1,'system_admin','2026-08-01 23:13:49'),(2,'head_teacher','2026-08-01 23:13:49'),(3,'deputy_head_teacher','2026-08-01 23:13:49'),(4,'sponsor_coordinator','2026-08-01 23:13:49'),(5,'teacher','2026-08-01 23:13:49'),(6,'parent_guardian','2026-08-01 23:13:49'),(7,'sponsor','2026-08-01 23:13:49'),(8,'student','2026-08-01 23:13:49');
/*!40000 ALTER TABLE `roles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sponsors`
--

DROP TABLE IF EXISTS `sponsors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sponsors` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) unsigned DEFAULT NULL,
  `sponsor_type` enum('individual','church','ministry','ngo','foundation','general') NOT NULL,
  `name` varchar(150) NOT NULL,
  `contact_person` varchar(150) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sponsors_user_id_unique` (`user_id`),
  KEY `idx_sponsor_type` (`sponsor_type`),
  CONSTRAINT `sponsors_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sponsors`
--

LOCK TABLES `sponsors` WRITE;
/*!40000 ALTER TABLE `sponsors` DISABLE KEYS */;
INSERT INTO `sponsors` VALUES (1,NULL,'church','Grace Fellowship Church','Pastor James Mwangi','0722334455','info@gracefellowship.org',NULL,NULL,'2026-08-02 18:57:20','2026-08-02 18:57:20'),(2,NULL,'individual','John Kamau',NULL,NULL,NULL,NULL,NULL,'2026-08-02 18:58:39','2026-08-02 18:58:39');
/*!40000 ALTER TABLE `sponsors` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sponsorships`
--

DROP TABLE IF EXISTS `sponsorships`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sponsorships` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `sponsor_id` bigint(20) unsigned NOT NULL,
  `student_id` bigint(20) unsigned DEFAULT NULL,
  `program_name` varchar(150) DEFAULT NULL,
  `sponsorship_type` enum('individual','group','school_wide') NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date DEFAULT NULL,
  `status` enum('active','ended','paused') NOT NULL DEFAULT 'active',
  `notes` text DEFAULT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `sponsorships_created_by_foreign` (`created_by`),
  KEY `idx_sponsorship_sponsor` (`sponsor_id`),
  KEY `idx_sponsorship_student` (`student_id`),
  CONSTRAINT `sponsorships_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `sponsorships_sponsor_id_foreign` FOREIGN KEY (`sponsor_id`) REFERENCES `sponsors` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `sponsorships_student_id_foreign` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sponsorships`
--

LOCK TABLES `sponsorships` WRITE;
/*!40000 ALTER TABLE `sponsorships` DISABLE KEYS */;
INSERT INTO `sponsorships` VALUES (1,1,1,NULL,'individual','2026-01-15',NULL,'active','Full sponsorship for the 2026 academic year.',1,'2026-08-02 18:57:48','2026-08-02 18:57:48');
/*!40000 ALTER TABLE `sponsorships` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `staff`
--

DROP TABLE IF EXISTS `staff`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `staff` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) unsigned DEFAULT NULL,
  `department_id` bigint(20) unsigned DEFAULT NULL,
  `staff_type` enum('teaching','non_teaching') NOT NULL,
  `role_title` varchar(60) NOT NULL,
  `first_name` varchar(80) NOT NULL,
  `last_name` varchar(80) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `employment_date` date NOT NULL,
  `contract_type` varchar(40) DEFAULT NULL,
  `status` enum('active','on_leave','terminated') NOT NULL DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `staff_user_id_unique` (`user_id`),
  KEY `idx_staff_type` (`staff_type`),
  KEY `idx_staff_department` (`department_id`),
  CONSTRAINT `staff_department_id_foreign` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `staff_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `staff`
--

LOCK TABLES `staff` WRITE;
/*!40000 ALTER TABLE `staff` DISABLE KEYS */;
INSERT INTO `staff` VALUES (1,NULL,NULL,'teaching','Class Teacher','Samuel','Kiptoo','0733112233','2025-09-01','permanent','active','2026-08-03 04:52:31','2026-08-03 04:52:31');
/*!40000 ALTER TABLE `staff` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `staff_documents`
--

DROP TABLE IF EXISTS `staff_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `staff_documents` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `staff_id` bigint(20) unsigned NOT NULL,
  `doc_type` varchar(60) NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `uploaded_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_staffdocs_staff` (`staff_id`),
  CONSTRAINT `staff_documents_staff_id_foreign` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `staff_documents`
--

LOCK TABLES `staff_documents` WRITE;
/*!40000 ALTER TABLE `staff_documents` DISABLE KEYS */;
/*!40000 ALTER TABLE `staff_documents` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `staff_emergency_contacts`
--

DROP TABLE IF EXISTS `staff_emergency_contacts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `staff_emergency_contacts` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `staff_id` bigint(20) unsigned NOT NULL,
  `full_name` varchar(150) NOT NULL,
  `relationship` varchar(30) DEFAULT NULL,
  `phone` varchar(20) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `staff_emergency_contacts_staff_id_foreign` (`staff_id`),
  CONSTRAINT `staff_emergency_contacts_staff_id_foreign` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `staff_emergency_contacts`
--

LOCK TABLES `staff_emergency_contacts` WRITE;
/*!40000 ALTER TABLE `staff_emergency_contacts` DISABLE KEYS */;
INSERT INTO `staff_emergency_contacts` VALUES (1,1,'Alice Kiptoo','Spouse','0733998877');
/*!40000 ALTER TABLE `staff_emergency_contacts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `staff_qualifications`
--

DROP TABLE IF EXISTS `staff_qualifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `staff_qualifications` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `staff_id` bigint(20) unsigned NOT NULL,
  `qualification` varchar(150) NOT NULL,
  `institution` varchar(150) DEFAULT NULL,
  `year_obtained` year(4) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_qual_staff` (`staff_id`),
  CONSTRAINT `staff_qualifications_staff_id_foreign` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `staff_qualifications`
--

LOCK TABLES `staff_qualifications` WRITE;
/*!40000 ALTER TABLE `staff_qualifications` DISABLE KEYS */;
INSERT INTO `staff_qualifications` VALUES (1,1,'Bachelor of Education','Kenyatta University',2019);
/*!40000 ALTER TABLE `staff_qualifications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `streams`
--

DROP TABLE IF EXISTS `streams`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `streams` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `class_id` bigint(20) unsigned NOT NULL,
  `name` varchar(30) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stream` (`class_id`,`name`),
  CONSTRAINT `streams_class_id_foreign` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `streams`
--

LOCK TABLES `streams` WRITE;
/*!40000 ALTER TABLE `streams` DISABLE KEYS */;
/*!40000 ALTER TABLE `streams` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `student_medical_info`
--

DROP TABLE IF EXISTS `student_medical_info`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `student_medical_info` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `student_id` bigint(20) unsigned NOT NULL,
  `conditions` text DEFAULT NULL,
  `allergies` text DEFAULT NULL,
  `emergency_contact_name` varchar(150) DEFAULT NULL,
  `emergency_contact_phone` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `student_medical_info_student_id_unique` (`student_id`),
  CONSTRAINT `student_medical_info_student_id_foreign` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `student_medical_info`
--

LOCK TABLES `student_medical_info` WRITE;
/*!40000 ALTER TABLE `student_medical_info` DISABLE KEYS */;
INSERT INTO `student_medical_info` VALUES (1,1,NULL,'None known',NULL,NULL);
/*!40000 ALTER TABLE `student_medical_info` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `students`
--

DROP TABLE IF EXISTS `students`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `students` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `admission_no` varchar(20) NOT NULL,
  `first_name` varchar(80) NOT NULL,
  `last_name` varchar(80) NOT NULL,
  `date_of_birth` date NOT NULL,
  `gender` enum('male','female') NOT NULL,
  `class_id` bigint(20) unsigned NOT NULL,
  `stream_id` bigint(20) unsigned DEFAULT NULL,
  `photo_path` varchar(255) DEFAULT NULL,
  `status` enum('active','promoted','transferred','left') NOT NULL DEFAULT 'active',
  `admission_date` date NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `students_admission_no_unique` (`admission_no`),
  KEY `students_stream_id_foreign` (`stream_id`),
  KEY `idx_students_class` (`class_id`,`stream_id`),
  KEY `idx_students_status` (`status`),
  CONSTRAINT `students_class_id_foreign` FOREIGN KEY (`class_id`) REFERENCES `classes` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `students_stream_id_foreign` FOREIGN KEY (`stream_id`) REFERENCES `streams` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `students`
--

LOCK TABLES `students` WRITE;
/*!40000 ALTER TABLE `students` DISABLE KEYS */;
INSERT INTO `students` VALUES (1,'MGA-2026-0001','Mary','Achieng','2019-03-15','female',2,NULL,NULL,'active','2026-01-15','2026-08-02 13:02:14','2026-08-02 13:25:06'),(2,'MGA-2026-0002','Peter','Otieno','2018-06-10','male',1,NULL,NULL,'active','2026-01-15','2026-08-02 19:12:47','2026-08-02 19:12:47');
/*!40000 ALTER TABLE `students` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `subjects`
--

DROP TABLE IF EXISTS `subjects`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `subjects` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(60) NOT NULL,
  `code` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `subjects_name_unique` (`name`),
  UNIQUE KEY `subjects_code_unique` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `subjects`
--

LOCK TABLES `subjects` WRITE;
/*!40000 ALTER TABLE `subjects` DISABLE KEYS */;
INSERT INTO `subjects` VALUES (1,'Mathematics',NULL);
/*!40000 ALTER TABLE `subjects` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `terms`
--

DROP TABLE IF EXISTS `terms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `terms` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `academic_year_id` bigint(20) unsigned NOT NULL,
  `name` varchar(20) NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `is_current` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_term` (`academic_year_id`,`name`),
  CONSTRAINT `terms_academic_year_id_foreign` FOREIGN KEY (`academic_year_id`) REFERENCES `academic_years` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `terms`
--

LOCK TABLES `terms` WRITE;
/*!40000 ALTER TABLE `terms` DISABLE KEYS */;
INSERT INTO `terms` VALUES (1,1,'Term 1','2026-01-01','2026-04-30',1);
/*!40000 ALTER TABLE `terms` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `users` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role_id` bigint(20) unsigned NOT NULL,
  `status` enum('active','inactive','locked') NOT NULL DEFAULT 'active',
  `last_login_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_username_unique` (`username`),
  UNIQUE KEY `users_email_unique` (`email`),
  KEY `idx_users_role` (`role_id`),
  KEY `idx_users_status` (`status`),
  CONSTRAINT `users_role_id_foreign` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'admin','admin@mgaems.local','$2y$12$pMz2L4agyehUrBLHe0O26.2YNDJTgH1.6l8OzWr2sNyQVNJMI0Rte',1,'active','2026-08-03 11:20:51','2026-08-01 23:13:50','2026-08-03 11:20:51'),(2,'grace.achieng','grace.achieng@example.com','$2y$12$JH7GfXwuVSxwVeSX2ui7lun0RH2/Kcx.JBj2K.xBsgTLpUTYI5dX6',6,'active','2026-08-03 04:59:43','2026-08-02 19:05:19','2026-08-03 04:59:43');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `visitors`
--

DROP TABLE IF EXISTS `visitors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `visitors` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `host_staff_id` bigint(20) unsigned NOT NULL,
  `visitor_name` varchar(150) NOT NULL,
  `visitor_type` enum('visitor','church_team','mission_group','volunteer','donor') NOT NULL,
  `purpose` varchar(255) DEFAULT NULL,
  `visit_date` date NOT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `visitors_host_staff_id_foreign` (`host_staff_id`),
  KEY `idx_visitor_date` (`visit_date`),
  CONSTRAINT `visitors_host_staff_id_foreign` FOREIGN KEY (`host_staff_id`) REFERENCES `staff` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `visitors`
--

LOCK TABLES `visitors` WRITE;
/*!40000 ALTER TABLE `visitors` DISABLE KEYS */;
INSERT INTO `visitors` VALUES (1,1,'Grace Fellowship Church Team','church_team','Sponsorship check-in visit','2026-08-03','Brought school supplies for sponsored learners.','2026-08-03 05:19:12','2026-08-03 05:19:12');
/*!40000 ALTER TABLE `visitors` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-08-03 14:24:57
