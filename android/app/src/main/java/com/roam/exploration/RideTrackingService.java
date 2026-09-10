package com.roam.exploration;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.*;
import android.os.*;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import org.json.*;

/** A user-started foreground service; fixes survive WebView backgrounding. */
public class RideTrackingService extends Service implements LocationListener {
  static final String START = "com.roam.exploration.START_RIDE_TRACKING", STOP = "com.roam.exploration.STOP_RIDE_TRACKING";
  private static final String CHANNEL = "ride_tracking"; private LocationManager manager;
  @Override public void onCreate() { super.onCreate(); manager=(LocationManager)getSystemService(LOCATION_SERVICE); if(Build.VERSION.SDK_INT>=26)((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL,"Ride tracking",NotificationManager.IMPORTANCE_LOW)); }
  @Override public int onStartCommand(Intent intent,int flags,int id) { if(intent!=null&&STOP.equals(intent.getAction())) { stop(); return START_NOT_STICKY; } if(!allowed()) { stopSelf(); return START_NOT_STICKY; } Notification n=new NotificationCompat.Builder(this,CHANNEL).setContentTitle("Roam is recording your ride").setContentText("Location tracking is active").setSmallIcon(R.drawable.ic_launcher_foreground).setOngoing(true).build(); if(Build.VERSION.SDK_INT>=29)startForeground(1001,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);else startForeground(1001,n); manager.requestLocationUpdates(LocationManager.GPS_PROVIDER,5000,0,this,Looper.getMainLooper()); getSharedPreferences("ride_tracking",MODE_PRIVATE).edit().putBoolean("active",true).apply(); return START_STICKY; }
  @Override public void onLocationChanged(Location l) { try { SharedPreferences p=getSharedPreferences("ride_tracking",MODE_PRIVATE); JSONArray points=new JSONArray(p.getString("points","[]")); JSONObject x=new JSONObject(); x.put("lat",l.getLatitude());x.put("lng",l.getLongitude());x.put("accuracy",l.getAccuracy());x.put("timestamp",l.getTime());points.put(x);while(points.length()>10000)points.remove(0);p.edit().putString("points",points.toString()).apply(); }catch(Exception ignored){} }
  private boolean allowed(){return ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED||ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;}
  private void stop(){manager.removeUpdates(this);getSharedPreferences("ride_tracking",MODE_PRIVATE).edit().putBoolean("active",false).apply();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
  @Override public IBinder onBind(Intent i){return null;}
}
