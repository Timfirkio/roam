package com.roam.exploration;

import android.content.Intent;
import android.content.ClipData;
import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.net.Uri;
import java.io.File;
import java.io.FileOutputStream;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "RideTracking")
public class RideTrackingPlugin extends Plugin implements SensorEventListener {
  private SensorManager sensorManager;
  private Sensor rotationSensor;
  private final float[] rotationMatrix = new float[9];
  private final float[] orientation = new float[3];
  private long lastOrientationEventMs;

  @PluginMethod public void startOrientation(PluginCall call) {
    sensorManager = (SensorManager)getContext().getSystemService(Context.SENSOR_SERVICE);
    rotationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
    if (rotationSensor == null) { call.reject("Rotation sensor unavailable"); return; }
    sensorManager.unregisterListener(this);
    if (!sensorManager.registerListener(this, rotationSensor, SensorManager.SENSOR_DELAY_GAME)) {
      call.reject("Unable to start rotation sensor"); return;
    }
    call.resolve();
  }

  @PluginMethod public void stopOrientation(PluginCall call) {
    if (sensorManager != null) sensorManager.unregisterListener(this);
    call.resolve();
  }

  @Override public void onSensorChanged(SensorEvent event) {
    if (event.sensor.getType() != Sensor.TYPE_ROTATION_VECTOR || event.accuracy == SensorManager.SENSOR_STATUS_UNRELIABLE) return;
    long now = android.os.SystemClock.elapsedRealtime();
    if (now - lastOrientationEventMs < 50) return;
    lastOrientationEventMs = now;
    SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values);
    SensorManager.getOrientation(rotationMatrix, orientation);
    JSObject reading = new JSObject();
    reading.put("heading", (Math.toDegrees(orientation[0]) + 360) % 360);
    reading.put("pitch", Math.toDegrees(orientation[1]));
    reading.put("roll", Math.toDegrees(orientation[2]));
    notifyListeners("orientation", reading);
  }

  @Override public void onAccuracyChanged(Sensor sensor, int accuracy) {}

  @Override protected void handleOnDestroy() {
    if (sensorManager != null) sensorManager.unregisterListener(this);
    super.handleOnDestroy();
  }
  @PluginMethod public void start(PluginCall call) { ContextCompat.startForegroundService(getContext(), new Intent(getContext(), RideTrackingService.class).setAction(RideTrackingService.START)); call.resolve(); }
  @PluginMethod public void stop(PluginCall call) { getContext().startService(new Intent(getContext(), RideTrackingService.class).setAction(RideTrackingService.STOP)); call.resolve(); }
  @PluginMethod public void drainPoints(PluginCall call) {
    try {
      JSObject result=new JSObject();
      result.put("points",RidePointStore.get(getContext()).drain());
      call.resolve(result);
    } catch(Exception error) { call.reject("Unable to drain ride points",error); }
  }
  @PluginMethod public void getRecordedRoute(PluginCall call) {
    try {
      JSObject result=new JSObject();
      result.put("points",RidePointStore.get(getContext()).route());
      call.resolve(result);
    } catch(Exception error) { call.reject("Unable to read recorded ride",error); }
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
