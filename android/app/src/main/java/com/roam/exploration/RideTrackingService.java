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
  private static final String CHANNEL = "ride_tracking";
  // At 12 m/s, a one-second GPS fix is 12 m apart: enough to preserve turns
  // and parallel cycleways without treating a stationary light as movement.
  private static final long MOVING_INTERVAL_MS = 1000L;
  private static final float MOVING_DISTANCE_METERS = 2f;
  private static final int MAX_ROUTE_POINTS = 21600; // six hours at one fix/sec
  private LocationManager manager;
  @Override public void onCreate() { super.onCreate(); manager=(LocationManager)getSystemService(LOCATION_SERVICE); if(Build.VERSION.SDK_INT>=26)((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL,"Ride tracking",NotificationManager.IMPORTANCE_LOW)); }
  @Override public int onStartCommand(Intent intent,int flags,int id) {
    if(intent!=null&&STOP.equals(intent.getAction())) { stop(); return START_NOT_STICKY; }
    if(!allowed()) { stopSelf(); return START_NOT_STICKY; }
    SharedPreferences preferences=getSharedPreferences("ride_tracking",MODE_PRIVATE);
    boolean alreadyActive=preferences.getBoolean("active",false);
    if(!alreadyActive) preferences.edit().putBoolean("active",true).putLong("startedAt",System.currentTimeMillis()).putString("points","[]").putString("route","[]").apply();
    Notification n=new NotificationCompat.Builder(this,CHANNEL).setContentTitle("Roam is recording your ride").setContentText("Location tracking is active").setSmallIcon(R.drawable.ic_launcher_foreground).setOngoing(true).build();
    if(Build.VERSION.SDK_INT>=29)startForeground(1001,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);else startForeground(1001,n);
    manager.removeUpdates(this);
    if(manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) manager.requestLocationUpdates(LocationManager.GPS_PROVIDER,MOVING_INTERVAL_MS,MOVING_DISTANCE_METERS,this,Looper.getMainLooper());
    return START_STICKY;
  }
  @Override public void onLocationChanged(Location l) { try { if(l.hasAccuracy()&&l.getAccuracy()>75f)return; SharedPreferences p=getSharedPreferences("ride_tracking",MODE_PRIVATE); JSONArray points=new JSONArray(p.getString("points","[]")); JSONArray route=new JSONArray(p.getString("route","[]")); JSONObject x=new JSONObject(); x.put("lat",l.getLatitude());x.put("lng",l.getLongitude());x.put("accuracy",l.getAccuracy());x.put("timestamp",l.getTime());x.put("speed",l.hasSpeed()?l.getSpeed():JSONObject.NULL);x.put("bearing",l.hasBearing()?l.getBearing():JSONObject.NULL);points.put(x);route.put(x);while(points.length()>10000)points.remove(0);while(route.length()>MAX_ROUTE_POINTS)route.remove(0);p.edit().putString("points",points.toString()).putString("route",route.toString()).apply(); }catch(Exception ignored){} }
  private boolean allowed(){return ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED||ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;}
  private void stop(){manager.removeUpdates(this);getSharedPreferences("ride_tracking",MODE_PRIVATE).edit().putBoolean("active",false).remove("startedAt").apply();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
  @Override public IBinder onBind(Intent i){return null;}
}
