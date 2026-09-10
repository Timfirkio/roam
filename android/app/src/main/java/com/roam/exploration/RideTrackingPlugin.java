package com.roam.exploration;

import android.content.Intent;
import android.content.ClipData;
import android.net.Uri;
import java.io.File;
import java.io.FileOutputStream;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "RideTracking")
public class RideTrackingPlugin extends Plugin {
  @PluginMethod public void start(PluginCall call) { ContextCompat.startForegroundService(getContext(), new Intent(getContext(), RideTrackingService.class).setAction(RideTrackingService.START)); call.resolve(); }
  @PluginMethod public void stop(PluginCall call) { getContext().startService(new Intent(getContext(), RideTrackingService.class).setAction(RideTrackingService.STOP)); call.resolve(); }
  @PluginMethod public void drainPoints(PluginCall call) {
    android.content.SharedPreferences preferences=getContext().getSharedPreferences("ride_tracking", android.content.Context.MODE_PRIVATE);
    JSObject result=new JSObject();
    try { result.put("points",new JSArray(preferences.getString("points","[]"))); preferences.edit().putString("points","[]").apply(); }
    catch(Exception error) { result.put("points",new JSArray()); }
    call.resolve(result);
  }
  @PluginMethod public void getRecordedRoute(PluginCall call) {
    android.content.SharedPreferences preferences=getContext().getSharedPreferences("ride_tracking", android.content.Context.MODE_PRIVATE);
    JSObject result=new JSObject();
    try { result.put("points",new JSArray(preferences.getString("route","[]"))); }
    catch(Exception error) { result.put("points",new JSArray()); }
    call.resolve(result);
  }
  @PluginMethod public void shareGpx(PluginCall call) {
    try {
      String contents=call.getString("contents"); String fileName=call.getString("fileName","roam-ride.gpx");
      if(contents==null) { call.reject("Missing GPX contents"); return; }
      File file=new File(getContext().getCacheDir(),fileName);
      try(FileOutputStream output=new FileOutputStream(file)) { output.write(contents.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
      Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",file);
      Intent share=new Intent(Intent.ACTION_SEND).setType("application/gpx+xml").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      share.setClipData(ClipData.newRawUri("Roam GPX",uri));
      getActivity().startActivity(Intent.createChooser(share,"Export Roam ride")); call.resolve();
    } catch(Exception error) { call.reject("Unable to share GPX",error); }
  }
  @PluginMethod public void getState(PluginCall call) {
    android.content.SharedPreferences preferences=getContext().getSharedPreferences("ride_tracking", android.content.Context.MODE_PRIVATE);
    JSObject result=new JSObject(); result.put("active",preferences.getBoolean("active",false));
    if(preferences.contains("startedAt")) result.put("startedAt",preferences.getLong("startedAt",0)); else result.put("startedAt",JSONObject.NULL);
    call.resolve(result);
  }
}
