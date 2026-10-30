BEGIN;
SELECT set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',TRUE);
INSERT INTO public.pharmacy_staff(id,pharmacy_id,name,role,pin_hash,permissions) VALUES
 ('90000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Receiver','pharmacist','unused','{"can_adjust_stock":true,"can_change_prices":true}'),
 ('90000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Cashier','cashier','unused','{"can_sell":true}');
INSERT INTO public.pharmacy_staff_sessions(pharmacy_id,staff_id,token_hash,expires_at) VALUES
 ('10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001',encode(extensions.digest('receiver-token','sha256'),'hex'),NOW()+INTERVAL '1 day'),
 ('10000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002',encode(extensions.digest('cashier-token','sha256'),'hex'),NOW()+INTERVAL '1 day');
CREATE FUNCTION pg_temp.assert_true(BOOLEAN,TEXT) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN IF $1 IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'FAIL: %',$2; END IF; END; $$;
DO $$
DECLARE
 ph UUID:='10000000-0000-4000-8000-000000000001'; supplier UUID:='30000000-0000-4000-8000-000000000001';
 a UUID:='40000000-0000-4000-8000-000000000001'; b UUID:='40000000-0000-4000-8000-000000000002'; c UUID:='40000000-0000-4000-8000-000000000003';
 command JSONB; result JSONB; result2 JSONB; tokens JSONB:='{"price_change":"approved-price_change","restore_inventory":"approved-restore_inventory","stock_adjustment":"approved-stock_adjustment"}';
 receipt UUID; inventory UUID; batch UUID; sale UUID; po UUID; poi UUID; line JSONB; count_before INTEGER; stock_before INTEGER; snapshot NUMERIC;
BEGIN
 command:=jsonb_build_object('action','receive','supplier_id',supplier,'request_key',gen_random_uuid(),'invoice_reference','INV-1','lines',jsonb_build_array(jsonb_build_object('product_id',a,'quantity_received',2,'unit_cost',120,'selling_price',200,'batch_number','BATCH-A','expiry_date',CURRENT_DATE+365)));
 result:=public.write_procurement(ph,command,NULL,tokens);
 PERFORM pg_temp.assert_true(result->>'code'='STAFF_AUTH_REQUIRED','missing staff must fail');
 result:=public.write_procurement(ph,command,'cashier-token',tokens);
 PERFORM pg_temp.assert_true(result->>'code'='STAFF_PERMISSION_DENIED','cashier must not receive');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM goods_receipts),'denied writes made no receipts');
 BEGIN
   PERFORM public.write_procurement('10000000-0000-4000-8000-000000000002',command,'receiver-token',tokens);
   RAISE EXCEPTION 'FAIL: cross tenant write succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated','public.receive_goods(uuid,uuid,uuid,text,jsonb)','EXECUTE'),'legacy receiving still public');
 PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated','public.purchase_orders','UPDATE'),'direct order edits still allowed');
 RAISE NOTICE 'PASS staff, tenant and legacy-path enforcement';

 BEGIN PERFORM public.write_procurement(ph,command-'request_key','receiver-token',tokens); RAISE EXCEPTION 'FAIL: missing key accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.write_procurement(ph,jsonb_set(command,'{lines,0,selling_price}','null'),'receiver-token',tokens); RAISE EXCEPTION 'FAIL: new item without selling price accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.write_procurement(ph,command,'receiver-token','{}'); RAISE EXCEPTION 'FAIL: price SP gate bypassed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 result:=public.write_procurement(ph,command,'receiver-token',tokens); receipt:=(result->>'receipt_id')::UUID;
 result2:=public.write_procurement(ph,command,'receiver-token',tokens);
 SELECT id INTO inventory FROM pharmacy_inventory WHERE product_id=a;
 PERFORM pg_temp.assert_true(result2->>'receipt_id'=receipt::TEXT AND (result2->>'replayed')::BOOLEAN,'retry not replayed');
 PERFORM pg_temp.assert_true((SELECT quantity_in_stock FROM pharmacy_inventory WHERE id=inventory)=2,'retry added stock twice');
 PERFORM pg_temp.assert_true((SELECT price FROM pharmacy_inventory WHERE id=inventory)=200,'new selling price not explicit');
 PERFORM pg_temp.assert_true((SELECT staff_id FROM goods_receipts WHERE id=receipt)='90000000-0000-4000-8000-000000000001'::UUID,'staff attribution missing');
 BEGIN PERFORM public.write_procurement(ph,jsonb_set(command,'{notes}','"changed"'),'receiver-token',tokens); RAISE EXCEPTION 'FAIL: changed retry accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.write_procurement(ph,jsonb_set(command,'{request_key}',to_jsonb(gen_random_uuid())),'receiver-token',tokens); RAISE EXCEPTION 'FAIL: duplicate invoice accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 RAISE NOTICE 'PASS safe retries, invoice duplicates, explicit retail pricing and staff attribution';

 SELECT batch_id INTO batch FROM goods_receipt_items WHERE receipt_id=receipt;
 INSERT INTO sales(pharmacy_id,total,subtotal) VALUES(ph,200,200) RETURNING id INTO sale;
 INSERT INTO sale_items(sale_id,inventory_id,batch_id,quantity,line_total,unit_cost_snapshot) VALUES(sale,inventory,batch,1,200,999);
 INSERT INTO stock_movements(inventory_id,batch_id,type,quantity) VALUES(inventory,batch,'sale',-1);
 command:=jsonb_set(command,'{request_key}',to_jsonb(gen_random_uuid()))-'invoice_reference';
 command:=jsonb_set(command,'{lines,0,unit_cost}','150');
 PERFORM public.write_procurement(ph,command,'receiver-token',tokens);
 PERFORM pg_temp.assert_true((SELECT count(*) FROM batches WHERE batch_number='BATCH-A')=2,'receipt cost layers merged');
 PERFORM pg_temp.assert_true((SELECT unit_cost_snapshot FROM sale_items WHERE sale_id=sale)=120,'historical cost changed or client spoofed snapshot');
 PERFORM pg_temp.assert_true((public.get_pharmacy_reports(ph,CURRENT_DATE,CURRENT_DATE)->'margin_per_product'->0->>'cogs')::NUMERIC=120,'report not using sale snapshot');
 PERFORM pg_temp.assert_true((SELECT price FROM pharmacy_inventory WHERE id=inventory)=200,'existing price overwritten');
 BEGIN UPDATE sale_items SET unit_cost_snapshot=999 WHERE sale_id=sale; RAISE EXCEPTION 'FAIL: snapshot mutable'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.write_procurement(ph,jsonb_build_object('action','receipt_reverse','id',receipt,'reason','Wrong delivery'),'receiver-token',tokens); RAISE EXCEPTION 'FAIL: sold stock reversal accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS cost layers, frozen sale COGS, report stability and sold-stock reversal guard';

 result:=public.write_procurement(ph,jsonb_build_object('action','po_create','supplier_id',supplier,'items',jsonb_build_array(jsonb_build_object('product_id',b,'quantity_ordered',10,'unit_cost',100),jsonb_build_object('product_id',c,'quantity_ordered',10,'unit_cost',90))),'receiver-token',tokens);
 po:=(result->>'purchase_order_id')::UUID;
 -- Draft editing/cancellation uses the same tenant and staff boundary.
 PERFORM public.write_procurement(ph,jsonb_build_object('action','po_status','id',po,'status','sent'),'receiver-token',tokens);
 SELECT id INTO poi FROM purchase_order_items WHERE po_id=po AND product_id=b;
 line:=jsonb_build_object('po_item_id',poi,'product_id',b,'quantity_received',1,'receiving_unit','pack','units_per_pack',5,'unit_cost',600,'selling_price',250,'batch_number','PACK-1','expiry_date',CURRENT_DATE+365);
 command:=jsonb_build_object('action','receive','supplier_id',supplier,'po_id',po,'request_key',gen_random_uuid(),'lines',jsonb_build_array(line));
 result:=public.write_procurement(ph,command,'receiver-token',tokens);
 PERFORM pg_temp.assert_true((SELECT quantity_received FROM purchase_order_items WHERE id=poi)=5,'pack conversion wrong');
 PERFORM pg_temp.assert_true((SELECT status FROM purchase_orders WHERE id=po)='partially_received','partial order not supported');
 PERFORM pg_temp.assert_true((SELECT count(*) FROM pharmacy_inventory WHERE product_id=c)=0,'undelivered item added');
 line:=jsonb_set(line,'{quantity_received}','2'); line:=jsonb_set(line,'{receiving_unit}','"base"');line:=jsonb_set(line,'{units_per_pack}','1');line:=jsonb_set(line,'{unit_cost}','150');
 command:=jsonb_set(command,'{request_key}',to_jsonb(gen_random_uuid()));
 command:=jsonb_set(command,'{lines}',jsonb_build_array(line,jsonb_set(jsonb_set(line,'{quantity_received}','3'),'{batch_number}','"PACK-2"')));
 result:=public.write_procurement(ph,command,'receiver-token',tokens); receipt:=(result->>'receipt_id')::UUID;
 PERFORM pg_temp.assert_true((SELECT quantity_received FROM purchase_order_items WHERE id=poi)=10,'split batch total wrong');
 PERFORM pg_temp.assert_true((SELECT subtotal FROM purchase_orders WHERE id=po)=1900,'ordered price was overwritten');
 PERFORM pg_temp.assert_true((SELECT sum(ri.line_total) FROM goods_receipt_items ri JOIN goods_receipts gr ON gr.id=ri.receipt_id WHERE gr.po_id=po)=1350,'actual delivery costs wrong');
 PERFORM pg_temp.assert_true((SELECT count(*) FROM goods_receipt_items WHERE receipt_id=receipt)=2,'batch split lost');
 BEGIN PERFORM public.write_procurement(ph,jsonb_set(command,'{request_key}',to_jsonb(gen_random_uuid())),'receiver-token',tokens); RAISE EXCEPTION 'FAIL: overreceipt accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS partial orders, skipped lines, pack conversion, split batches and separate ordered/received totals';

 result:=public.write_procurement(ph,jsonb_build_object('action','receipt_reverse','id',receipt,'reason','Incorrect batch delivery'),'receiver-token',tokens);
 PERFORM pg_temp.assert_true((SELECT quantity_received FROM purchase_order_items WHERE id=poi)=5,'reversal did not reopen PO quantity');
 result2:=public.write_procurement(ph,jsonb_build_object('action','receipt_reverse','id',receipt,'reason','Incorrect batch delivery'),'receiver-token',tokens);
 PERFORM pg_temp.assert_true((result2->>'replayed')::BOOLEAN,'reversal retry not safe');
 RAISE NOTICE 'PASS receipt reversal and reversal retry';

 UPDATE pharmacy_inventory SET deleted_at=NOW(),recovery_expires_at=NOW()+INTERVAL '60 days',is_listed=FALSE WHERE id=inventory;
 command:=jsonb_build_object('action','receive','supplier_id',supplier,'request_key',gen_random_uuid(),'lines',jsonb_build_array(jsonb_build_object('product_id',a,'quantity_received',1,'unit_cost',180,'batch_number','RESTORE','expiry_date',CURRENT_DATE+365)));
 BEGIN PERFORM public.write_procurement(ph,command,'receiver-token',tokens); RAISE EXCEPTION 'FAIL: removed item silently restored'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
 command:=jsonb_set(command,'{lines,0,restore_deleted}','true');
 BEGIN PERFORM public.write_procurement(ph,command,'receiver-token','{}'); RAISE EXCEPTION 'FAIL: restore SP gate bypassed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
 PERFORM public.write_procurement(ph,command,'receiver-token',tokens);
 PERFORM pg_temp.assert_true((SELECT deleted_at IS NULL FROM pharmacy_inventory WHERE id=inventory),'restore and receive failed');
 UPDATE pharmacy_inventory SET deleted_at=NOW()-INTERVAL '61 days',recovery_expires_at=NOW()-INTERVAL '1 day' WHERE id=inventory;
 command:=jsonb_set(command,'{request_key}',to_jsonb(gen_random_uuid()));
 BEGIN PERFORM public.write_procurement(ph,command,'receiver-token',tokens); RAISE EXCEPTION 'FAIL: expired recovery accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS explicit recovery, SP restoration gate and 60-day expiry';

 SELECT count(*) INTO count_before FROM goods_receipts;
 command:=jsonb_set(command,'{request_key}',to_jsonb(gen_random_uuid()));
 command:=jsonb_set(command,'{lines}',jsonb_build_array(jsonb_build_object('product_id',c,'quantity_received',1,'unit_cost',100,'selling_price',200,'batch_number','VALID','expiry_date',CURRENT_DATE+365),jsonb_build_object('product_id',c,'quantity_received',1,'unit_cost',100,'batch_number','EXPIRED','expiry_date',CURRENT_DATE)));
 BEGIN PERFORM public.write_procurement(ph,command,'receiver-token',tokens); RAISE EXCEPTION 'FAIL: expired batch accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_true((SELECT count(*) FROM goods_receipts)=count_before AND NOT EXISTS(SELECT 1 FROM batches WHERE batch_number='VALID'),'failed receipt partially committed');
 RAISE NOTICE 'PASS expired-stock rejection and atomic rollback';
END; $$;
DO $$
DECLARE ph UUID:='10000000-0000-4000-8000-000000000001'; supplier UUID:='30000000-0000-4000-8000-000000000001'; product UUID:='40000000-0000-4000-8000-000000000003'; command JSONB; result JSONB; po UUID; inventory UUID;
BEGIN
  command:=jsonb_build_object('action','po_create','supplier_id',supplier,'items',jsonb_build_array(jsonb_build_object('product_id',product,'quantity_ordered',4,'unit_cost',100)));
  result:=public.write_procurement(ph,command,'receiver-token','{}');po:=(result->>'purchase_order_id')::UUID;
  command:=command||jsonb_build_object('action','po_update','id',po,'notes','Edited draft','items',jsonb_build_array(jsonb_build_object('product_id',product,'quantity_ordered',8,'unit_cost',110)));
  PERFORM public.write_procurement(ph,command,'receiver-token','{}');
  PERFORM pg_temp.assert_true((SELECT subtotal FROM purchase_orders WHERE id=po)=880,'draft edit total wrong');
  PERFORM public.write_procurement(ph,jsonb_build_object('action','po_status','id',po,'status','cancelled'),'receiver-token','{}');
  BEGIN PERFORM public.write_procurement(ph,command,'receiver-token','{}');RAISE EXCEPTION 'FAIL: cancelled order edited';EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;END;
  RAISE NOTICE 'PASS draft editing, cancellation and invalid status transitions';
  command:=jsonb_build_object('action','receive','supplier_id',supplier,'request_key',gen_random_uuid(),'lines',jsonb_build_array(jsonb_build_object('product_id',product,'quantity_received',2,'unit_cost',100,'selling_price',200,'batch_number','SHORT','expiry_date',CURRENT_DATE+30)));
  BEGIN PERFORM public.write_procurement(ph,command,'receiver-token','{"price_change":"approved-price_change"}');RAISE EXCEPTION 'FAIL: short-dated stock accepted without confirmation';EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;END;
  command:=jsonb_set(command,'{lines,0,short_dated_confirmed}','true');
  result:=public.write_procurement(ph,command,'receiver-token','{"price_change":"approved-price_change"}');
  SELECT id INTO inventory FROM pharmacy_inventory WHERE product_id=product;
  INSERT INTO reservations(inventory_id,status,expires_at) VALUES(inventory,'active',NOW()+INTERVAL '1 day');
  BEGIN PERFORM public.write_procurement(ph,jsonb_build_object('action','receipt_reverse','id',result->>'receipt_id','reason','Incorrect delivery'),'receiver-token','{"stock_adjustment":"approved-stock_adjustment"}');RAISE EXCEPTION 'FAIL: reserved stock reversed';EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;END;
  UPDATE pharmacy_features SET is_enabled=FALSE WHERE pharmacy_id=ph AND feature_key='purchase_orders_and_receiving';
  BEGIN PERFORM public.write_procurement(ph,command,'receiver-token','{}');RAISE EXCEPTION 'FAIL: disabled feature accepted write';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  RAISE NOTICE 'PASS short-dated confirmation, reservation reversal guard and feature enforcement';
END; $$;
ROLLBACK;
