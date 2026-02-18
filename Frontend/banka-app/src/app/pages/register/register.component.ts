import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss'
})
export class RegisterComponent {
  errorMessage = '';
  successMessage = '';
  loading = false;

  form = this.fb.nonNullable.group({
    fullName: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router
  ) {
    if (this.auth.isAuthenticated()) {
      this.router.navigate(['/gastos']);
    }
  }

  async onSubmit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.errorMessage = '';
    this.successMessage = '';
    this.loading = true;
    const { fullName, email, password } = this.form.getRawValue();
    const { error } = await this.auth.signUp(email, password, fullName || undefined);
    this.loading = false;
    if (error) {
      this.errorMessage = error.message || 'Error al registrarse';
      return;
    }
    this.successMessage = 'Cuenta creada. Revisa tu email para confirmar (si esta configurado).';
    this.router.navigate(['/gastos']);
  }
}
