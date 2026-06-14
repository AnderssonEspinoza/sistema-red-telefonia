CREATE DATABASE IF NOT EXISTS asterisk;
GRANT ALL PRIVILEGES ON `asterisk`.* TO 'freepbxuser'@'%';

CREATE DATABASE IF NOT EXISTS asteriskcdrdb;
GRANT ALL PRIVILEGES ON `asteriskcdrdb`.* TO 'freepbxuser'@'%';

FLUSH PRIVILEGES;
