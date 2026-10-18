// Loaded explicitly in the owner proof runner, not in application descendants.
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

if (process.argv[1] === process.env.T3CODE_GUI_PROOF_ENTRY) {
  const root=process.env.T3CODE_GUI_PROOF_ROOT;
  const mode=process.env.T3CODE_GUI_PROOF_CASE;
  const original={read:fs.readFileSync,readdir:fs.readdirSync,append:fs.appendFileSync,spawn:childProcess.spawn,kill:process.kill};
  let launch;
  let backend;
  let rejectionPending=false;
  let identityFaultInjected=false;
  const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value),{mode:0o600});
  const injected=(name)=>{
    original.append(path.join(root,"fault-hits.jsonl"),JSON.stringify({name})+"\n",{mode:0o600});
    return Object.assign(new Error(`Injected ${name}`),{code:"EIO"});
  };
  childProcess.spawn=function(command,args,options) {
    const child=original.spawn.call(this,command,args,options);
    if(options?.env?.T3CODE_DESKTOP_SMOKE_ROOT && !launch) {
      launch={pid:child.pid,scratch:options.env.T3CODE_DESKTOP_SMOKE_ROOT,command,args};
      child.once("spawn",()=>{
        const fields=original.read(`/proc/${child.pid}/stat`,"utf8").split(") ").at(-1).trim().split(/\s+/);
        launch.identity=fields[19];launch.group=Number(fields[2]);
        write("launch.json",launch);
      });
      child.once("exit",(code,signal)=>write("launch-exit.json",{code,signal}));
    }
    return child;
  };
  fs.appendFileSync=function(file,data,...rest) {
    const result=original.append.call(this,file,data,...rest);
    if(path.basename(String(file)) === "processes.log") {
      const record=JSON.parse(String(data));
      original.append(path.join(root,"observed.jsonl"),JSON.stringify(record)+"\n",{mode:0o600});
      if(record.args.includes("--proof-backend") && !backend) {
        backend=record;
        const temporary=path.join(root,"backend-observed.tmp");
        fs.writeFileSync(temporary,JSON.stringify({...record,runnerPid:process.pid}),{mode:0o600});
        fs.renameSync(temporary,path.join(root,"backend-observed.json"));
      }
    }
    return result;
  };
  fs.readdirSync=function(file,...rest) {
    if(file === "/proc") {
      rejectionPending=false;
      if(mode === "earlyeio" || (mode === "discfail" && fs.existsSync(path.join(root,"fault-armed.json")))) {
        throw injected("process discovery");
      }
    }
    return original.readdir.call(this,file,...rest);
  };
  fs.readFileSync=function(file,...rest) {
    if(file === "/proc/self/mounts" && launch) {
      if(mode === "mount-read") throw injected("mount discovery");
      if(mode === "mount-malformed") return "malformed\n";
      const content=original.read.call(this,file,...rest);
      if(mode.startsWith("mount-")) {
        const state=path.join(launch.scratch,"state");
        const mount=mode === "mount-sibling" ? `${state}-sibling` : mode === "mount-root" ? state : path.join(state,"space tab\tback\\slash");
        const encoded=mount.replace(/\\/g,"\\134").replace(/ /g,"\\040").replace(/\t/g,"\\011");
        return content+`proof ${encoded} fuse rw 0 0\n`;
      }
    }
    const value=original.read.call(this,file,...rest);
    if(backend && file === `/proc/${backend.pid}/stat` && !identityFaultInjected &&
       ["identity-change","group-change"].includes(mode) && new Error().stack.includes("inspectKnownProcess")) {
      // Fault only the targeted revalidation, not discovery or unrelated processes.
      const split=value.lastIndexOf(") ")+2;
      const fields=value.slice(split).trim().split(/\s+/);
      if(mode === "identity-change") fields[19]=String(BigInt(fields[19])+1n);
      else fields[2]=String(Number(fields[2])+1);
      identityFaultInjected=true;rejectionPending=true;
      injected(mode);
      return value.slice(0,split)+fields.join(" ")+"\n";
    }
    return value;
  };
  process.kill=function(pid,signal) {
    if(backend && pid === -backend.group && rejectionPending) write("unsafe-signal.json",{pid,signal});
    return original.kill.call(this,pid,signal);
  };
  syncBuiltinESMExports();
}
