// CONSTRAINTS
CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE;
CREATE CONSTRAINT topic_postgres_id IF NOT EXISTS FOR (t:Topic) REQUIRE t.postgres_id IS UNIQUE;
CREATE CONSTRAINT concept_uid IF NOT EXISTS FOR (c:Concept) REQUIRE c.uid IS UNIQUE;
CREATE CONSTRAINT opinion_id IF NOT EXISTS FOR (o:Opinion) REQUIRE o.id IS UNIQUE;

// INDEXES
CREATE INDEX user_email IF NOT EXISTS FOR (u:User) ON (u.email);
CREATE INDEX opinion_lookup IF NOT EXISTS FOR (o:Opinion) ON (o.user_id, o.topic_id, o.opinion_number);