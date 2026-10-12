-- Answers to the contact form's extra questions (Sitio web → Formulario de
-- contacto), kept with the message: a JSON list of {id, label, value} with the
-- question's Spanish text as it was when the visitor answered.
ALTER TABLE leads ADD COLUMN answers TEXT NOT NULL DEFAULT '[]';
