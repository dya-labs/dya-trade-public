CREATE TABLE id_access_records (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data)='object'));
CREATE TRIGGER id_access_records_insert_version AFTER INSERT ON id_access_records
BEGIN
 INSERT INTO id_versions VALUES('accessRecords',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('accessRecords','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 UPDATE id_metadata SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER id_access_records_update_version AFTER UPDATE ON id_access_records
BEGIN
 INSERT INTO id_versions VALUES('accessRecords',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('accessRecords','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 UPDATE id_metadata SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER id_access_records_delete_version AFTER DELETE ON id_access_records
BEGIN
 INSERT INTO id_versions VALUES('accessRecords',OLD.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('accessRecords','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 UPDATE id_metadata SET revision=revision+1 WHERE id=1;
END;
