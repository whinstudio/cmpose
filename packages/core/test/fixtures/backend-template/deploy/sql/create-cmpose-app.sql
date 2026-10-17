-- Creates cmpose-app's own role and database.
CREATE ROLE cmpose_app LOGIN PASSWORD :'password';
CREATE DATABASE cmpose_app OWNER cmpose_app;
