import { expect,test } from "bun:test";
import { completion,dispatchIdentity } from "./orca.ts";
test("completion rejects prose PASS, wrong type, stale dispatch and foreign task",()=>{
 const m={type:"worker_done",payload:{taskId:"t",dispatchId:"d",verdict:"PASS"}};
 expect(completion({result:{message:m}},"t","d")).toBe(true);
 expect(completion({result:{message:m}},"t","old")).toBe(false);
 expect(completion({result:{message:m}},"foreign","d")).toBe(false);
 expect(completion({result:{message:{...m,type:"heartbeat"}}},"t","d")).toBe(false);
 expect(completion({result:{message:{type:"worker_done",body:"PASS",payload:{taskId:"t",dispatchId:"d"}}}},"t","d")).toBe(false);
 expect(completion({result:{count:0}},"t","d")).toBe(false);
});
test("dispatch IDs never fall back to RPC envelope IDs",()=>{
 expect(()=>dispatchIdentity(null,"t")).toThrow();
 expect(()=>dispatchIdentity({id:"rpc-id"},"t")).toThrow();
 expect(dispatchIdentity({id:"d",task_id:"t"},"t")).toBe("d");
});

test("installed runtime string payload is decoded strictly",()=>{
 expect(completion({result:{messages:[{type:"worker_done",payload:JSON.stringify({taskId:"t",dispatchId:"d",verdict:"PASS"})}]}},"t","d")).toBe(true);
 expect(completion({result:{messages:[{type:"worker_done",payload:"invalid JSON PASS"}]}},"t","d")).toBe(false);
});
