-- Fresh databases only: refuse to adapt existing wallet records.
CREATE TABLE id_fresh_upgrade (empty INTEGER CHECK(empty=1));
INSERT INTO id_fresh_upgrade SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM id_accounts) AND NOT EXISTS(SELECT 1 FROM id_sessions) AND NOT EXISTS(SELECT 1 FROM id_challenges) AND NOT EXISTS(SELECT 1 FROM id_orders) AND NOT EXISTS(SELECT 1 FROM id_trades) AND NOT EXISTS(SELECT 1 FROM id_deposits) AND NOT EXISTS(SELECT 1 FROM id_withdrawals) AND NOT EXISTS(SELECT 1 FROM id_write_guards) AND NOT EXISTS(SELECT 1 FROM id_metadata WHERE json_array_length(requests)!=0) THEN 1 ELSE 0 END;
DROP TABLE id_fresh_upgrade;
CREATE TABLE id_versions (collection TEXT NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0), PRIMARY KEY(collection,record_id));
ALTER TABLE id_write_guards ADD COLUMN dependencies TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(dependencies) AND json_type(dependencies)='array');
DROP TRIGGER id_guard_revision;
CREATE TRIGGER id_guard_revision
BEFORE INSERT ON id_write_guards
BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM id_metadata WHERE id=1 AND origin=NEW.expected_origin AND schema_version=NEW.expected_schema_version AND readiness='ready') THEN RAISE(ABORT,'DYA_ID_STORAGE_NOT_READY')
 WHEN EXISTS(SELECT 1 FROM json_each(NEW.dependencies) d WHERE coalesce((SELECT version FROM id_versions WHERE collection=json_extract(d.value,'$.collection') AND record_id=json_extract(d.value,'$.id')),0) != json_extract(d.value,'$.version')) THEN RAISE(ABORT,'DYA_ID_REVISION_CONFLICT') END);
END;
CREATE TRIGGER id_accounts_insert_version AFTER INSERT ON id_accounts
BEGIN
 INSERT INTO id_versions VALUES('accounts',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('accounts','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_accounts_update_version AFTER UPDATE ON id_accounts
BEGIN
 INSERT INTO id_versions VALUES('accounts',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('accounts','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_accounts_delete_version AFTER DELETE ON id_accounts
BEGIN
 INSERT INTO id_versions VALUES('accounts',OLD.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('accounts','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_sessions_insert_version AFTER INSERT ON id_sessions
BEGIN
 INSERT INTO id_versions VALUES('sessions',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('sessions','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_sessions_update_version AFTER UPDATE ON id_sessions
BEGIN
 INSERT INTO id_versions VALUES('sessions',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('sessions','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_sessions_delete_version AFTER DELETE ON id_sessions
BEGIN
 INSERT INTO id_versions VALUES('sessions',OLD.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('sessions','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_challenges_insert_version AFTER INSERT ON id_challenges
BEGIN
 INSERT INTO id_versions VALUES('challenges',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('challenges','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_challenges_update_version AFTER UPDATE ON id_challenges
BEGIN
 INSERT INTO id_versions VALUES('challenges',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('challenges','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_challenges_delete_version AFTER DELETE ON id_challenges
BEGIN
 INSERT INTO id_versions VALUES('challenges',OLD.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('challenges','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_orders_insert_version AFTER INSERT ON id_orders
BEGIN
 INSERT INTO id_versions VALUES('liveOrders',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('liveOrders','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_orders_update_version AFTER UPDATE ON id_orders
BEGIN
 INSERT INTO id_versions VALUES('liveOrders',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('liveOrders','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_orders_delete_version AFTER DELETE ON id_orders
BEGIN
 INSERT INTO id_versions VALUES('liveOrders',OLD.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('liveOrders','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_trades_insert_version AFTER INSERT ON id_trades
BEGIN
 INSERT INTO id_versions VALUES('liveTrades',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('liveTrades','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_trades_update_version AFTER UPDATE ON id_trades
BEGIN
 INSERT INTO id_versions VALUES('liveTrades',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('liveTrades','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_trades_delete_version AFTER DELETE ON id_trades
BEGIN
 INSERT INTO id_versions VALUES('liveTrades',OLD.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('liveTrades','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_deposits_insert_version AFTER INSERT ON id_deposits
BEGIN
 INSERT INTO id_versions VALUES('deposits',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('deposits','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_deposits_update_version AFTER UPDATE ON id_deposits
BEGIN
 INSERT INTO id_versions VALUES('deposits',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('deposits','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_deposits_delete_version AFTER DELETE ON id_deposits
BEGIN
 INSERT INTO id_versions VALUES('deposits',OLD.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('deposits','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_withdrawals_insert_version AFTER INSERT ON id_withdrawals
BEGIN
 INSERT INTO id_versions VALUES('withdrawals',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('withdrawals','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_withdrawals_update_version AFTER UPDATE ON id_withdrawals
BEGIN
 INSERT INTO id_versions VALUES('withdrawals',NEW.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('withdrawals','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_withdrawals_delete_version AFTER DELETE ON id_withdrawals
BEGIN
 INSERT INTO id_versions VALUES('withdrawals',OLD.id,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
 INSERT INTO id_versions VALUES('withdrawals','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_requests_version AFTER UPDATE OF requests ON id_metadata WHEN OLD.requests != NEW.requests
BEGIN
 INSERT INTO id_versions VALUES('requests','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
UPDATE id_metadata SET schema_version=2;
CREATE TRIGGER id_metadata_lifecycle_version AFTER UPDATE OF origin,schema_version,readiness ON id_metadata WHEN OLD.origin != NEW.origin OR OLD.schema_version != NEW.schema_version OR OLD.readiness != NEW.readiness
BEGIN
 INSERT INTO id_versions VALUES('metadata','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_metadata_insert_version AFTER INSERT ON id_metadata
BEGIN
 INSERT INTO id_versions VALUES('metadata','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER id_metadata_delete_version AFTER DELETE ON id_metadata
BEGIN
 INSERT INTO id_versions VALUES('metadata','',1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1;
END;
