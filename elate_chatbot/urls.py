"""
URL configuration for elate_chatbot project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework import permissions
from drf_yasg.views import get_schema_view
from drf_yasg import openapi

# API Schema for Swagger documentation
schema_view = get_schema_view(
    openapi.Info(
        title="Elate Moving Chatbot API",
        default_version='v1',
        description="AI-powered moving company chatbot API with real-time support and lead generation",
        terms_of_service="https://www.elate-moving.com/terms/",
        contact=openapi.Contact(email="support@elate-moving.com"),
        license=openapi.License(name="MIT License"),
    ),
    public=True,
    permission_classes=(permissions.AllowAny,),
)

urlpatterns = [
    # Django Admin
    path('admin/', admin.site.urls),
    
    # API Documentation
    path('api/docs/', schema_view.with_ui('swagger', cache_timeout=0), name='schema-swagger-ui'),
    path('api/redoc/', schema_view.with_ui('redoc', cache_timeout=0), name='schema-redoc'),
    
    # Authentication
    path('accounts/', include('allauth.urls')),
    
    # API Endpoints
    path('api/v1/', include([
        path('auth/', include('users.urls')),
        path('chatbot/', include('chatbot.urls')),
        path('analytics/', include('analytics.urls')),
        path('leads/', include('leads.urls')),
    ])),
    
    # Health Check
    path('health/', include('health_check.urls')),
]

# Serve static and media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    
    # Debug toolbar
    import debug_toolbar
    urlpatterns += [
        path('__debug__/', include(debug_toolbar.urls)),
    ]

# Custom error handlers
handler404 = 'elate_chatbot.views.custom_404'
handler500 = 'elate_chatbot.views.custom_500'
handler403 = 'elate_chatbot.views.custom_403'
