CREATE TABLE permissions (
  id     SERIAL       PRIMARY KEY,
  name   VARCHAR(100) NOT NULL UNIQUE,
  module VARCHAR(50)  NOT NULL
);
